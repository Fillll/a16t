"""GNU Radio channelization shared between RTL-SDR and file input."""

import math

from gnuradio import analog, blocks, filter, gr
from gnuradio.fft import window
from gnuradio.filter import firdes
import numpy as np

AUDIO_RATE = 16_000


class AudioSink(gr.sync_block):
    def __init__(self, index, writer):
        super().__init__(name=f"audio-{index}", in_sig=[np.float32], out_sig=None)
        self.index = index
        self.writer = writer

    def work(self, input_items, output_items):
        samples = input_items[0]
        pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
        self.writer.write(self.index, pcm.tobytes())
        return len(samples)


def configure_sdr(group, gain):
    from gnuradio import soapy

    source = soapy.source("driver=rtlsdr", "fc32", 1, "", "", [""], [""])
    source.set_sample_rate(0, group["sample_rate_hz"])
    source.set_frequency(0, group["center_frequency_hz"])
    ppm = group.get("ppm_error", 0)
    if ppm:
        source.set_frequency_correction(0, ppm)
    source.set_gain_mode(0, False)
    source.set_gain(0, "TUNER", gain if gain is not None else group.get("gain_db", 28))
    if "biastee" in {setting.key for setting in source.get_setting_info()}:
        source.write_setting("biastee", False)
    return source


def run_graph(profile, writer, args):
    group = profile["capture_groups"][0]
    rf_rate = group["sample_rate_hz"]
    chan_rate = group.get("channel_rate_hz", 240_000)
    graph = gr.top_block("A16T receiver")
    if args.mode == "live":
        source = configure_sdr(group, args.gain_db)
        if args.duration is not None:
            limit = blocks.head(gr.sizeof_gr_complex, math.ceil(rf_rate * args.duration))
            graph.connect(source, limit)
            source = limit
    else:
        size = args.iq_file.stat().st_size
        if not size or size % 2:
            raise ValueError("IQ file must contain whole interleaved unsigned I/Q byte pairs")
        raw = blocks.file_source(gr.sizeof_char, str(args.iq_file), False)
        # Reinterpret unsigned ADC bytes as signed two's-complement before normalization.
        source = blocks.interleaved_char_to_complex(False, 128.0)
        graph.connect(raw, blocks.add_const_bb(128), source)

    audio_pass = group.get("audio_pass_hz", 4_500)
    audio_stop = group.get("audio_stop_hz", 6_500)
    # Keep the squelch response time independent of the channel sample rate.
    squelch_alpha = 1 - (1 - 0.001) ** (240_000 / chan_rate)
    # Large continuous graphs need enough RF input per dispatch to feed the
    # channel decimators without waking hundreds of workers for tiny buffers.
    live_batch = len(profile["channels"]) >= 16 and args.mode == "live" and args.duration is None
    audio_batch = 256
    if live_batch:
        source.set_min_output_buffer(2 * audio_batch * (rf_rate // AUDIO_RATE))
    # The scheduler owns native blocks; keep Python work callbacks alive too.
    sinks = []
    for index, channel in enumerate(profile["channels"]):
        am = channel["modulation"] == "am"
        taps = firdes.low_pass(1.0, rf_rate, 10_000 if am else 12_500,
                               4_000 if am else 5_000, window.WIN_HAMMING)
        offset = channel["frequency_hz"] - group["center_frequency_hz"]
        translator = filter.freq_xlating_fir_filter_ccf(rf_rate // chan_rate, taps, offset, rf_rate)
        squelch = analog.pwr_squelch_cc(args.squelch_db, squelch_alpha, 0, False)
        decimation = chan_rate // AUDIO_RATE
        if am:
            demod = analog.am_demod_cf(chan_rate, decimation, audio_pass, audio_stop)
        else:
            demod = analog.fm_demod_cf(chan_rate, decimation, 5_000, audio_pass, audio_stop, tau=75e-6)
        sink = AudioSink(index, writer)
        dc = filter.dc_blocker_ff(32, True)
        if live_batch:
            translator.set_output_multiple(decimation * audio_batch)
            translator.set_min_output_buffer(4 * decimation * audio_batch)
            dc.set_min_output_buffer(8 * audio_batch)
            sink.set_output_multiple(audio_batch)
        sinks.append(sink)
        graph.connect(source, translator, squelch, demod, dc, sink)
    try:
        graph.run()
    except KeyboardInterrupt:
        graph.stop()
        graph.wait()
