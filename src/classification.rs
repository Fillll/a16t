/// A timeline label and the evidence used to assign it. Only an explicit
/// spoken priority signal can give a recording a distress, urgency or safety label.
pub fn classify(transcript: Option<&str>, default_kind: &str) -> (&'static str, &'static str) {
    if let Some(text) = transcript {
        let folded = text.to_lowercase().replace('é', "e").replace('\u{301}', "");
        let text = folded.trim_start();
        let speech = [
            "[static]",
            "[radio static]",
            "[noise]",
            "(static)",
            "(radio static)",
        ]
        .iter()
        .find_map(|caption| text.strip_prefix(caption))
        .unwrap_or(text);
        let words: Vec<_> = speech
            .split(|ch: char| !ch.is_alphanumeric())
            .filter(|word| !word.is_empty())
            .collect();
        if let Some(kind) = priority_call(&words) {
            return (kind, "transcript");
        }
        if port_call(&words) {
            return ("port", "transcript");
        }
    }
    match default_kind {
        "port" => ("port", "channel"),
        "commercial" => ("commercial", "channel"),
        "other" => ("other", "channel"),
        _ => ("unknown", "unknown"),
    }
}

fn priority_signal<'a>(words: &'a [&str]) -> Option<(&'static str, &'a [&'a str])> {
    match words {
        ["mayday", rest @ ..] | ["may", "day", rest @ ..] => Some(("distress", rest)),
        ["pan", "pan", rest @ ..] | ["panpan", rest @ ..] => Some(("urgency", rest)),
        ["securite", rest @ ..] => Some(("safety", rest)),
        // English speech recognition can render the French signal as "security".
        ["security", "security", "security", rest @ ..] => Some(("safety", rest)),
        _ => None,
    }
}

fn priority_call(words: &[&str]) -> Option<&'static str> {
    let (kind, mut body) = priority_signal(words)?;
    const EXCLUSIONS: &[&[&str]] = &[
        &["radio", "check"],
        &["a", "test"],
        &["a", "drill"],
        &["an", "exercise"],
        &["for", "training"],
        &["false", "alarm"],
        &["false", "alert"],
        &["cancel", "mayday"],
        &["cancel", "the", "mayday"],
        &["end", "of", "mayday"],
        &["end", "of", "distress"],
        &["not", "in", "distress"],
        &["distress", "is", "over"],
    ];
    // "This is not a drill" can accompany an actual call.
    if (1..words.len()).any(|i| {
        words[i - 1] != "not"
            && EXCLUSIONS
                .iter()
                .any(|phrase| words[i..].starts_with(phrase))
    }) {
        return None;
    }
    let mut repeated = false;
    while let Some((next, rest)) = priority_signal(body) {
        if next != kind {
            break;
        }
        repeated = true;
        body = rest;
    }
    // Phrases reporting, explaining or cancelling a call can also start with its name.
    const NON_CALL_OPENINGS: &[&str] = &[
        "means",
        "is",
        "was",
        "test",
        "drill",
        "exercise",
        "training",
        "cancel",
        "cancelled",
        "canceled",
        "practice",
    ];
    if body
        .first()
        .is_some_and(|word| NON_CALL_OPENINGS.contains(word))
    {
        return None;
    }
    const CALL_BODY: &[&[&str]] = &[
        &["this", "is"],
        &["all", "stations"],
        &["all", "ships"],
        &["relay"],
        &["we", "are"],
        &["we", "have"],
        &["we", "need"],
        &["we", "re", "sinking"],
        &["taking", "on", "water"],
        &["man", "overboard"],
        &["requesting", "assistance"],
    ];
    // An isolated "May Day" can also be the holiday.
    let isolated = body.is_empty() && words != ["may", "day"];
    (repeated || isolated || CALL_BODY.iter().any(|opening| body.starts_with(opening)))
        .then_some(kind)
}

fn contains_phrase(words: &[&str], phrase: &[&str]) -> bool {
    words.windows(phrase.len()).any(|part| part == phrase)
}

fn port_call(words: &[&str]) -> bool {
    const ADDRESSES: &[&[&str]] = &[
        &["port", "control"],
        &["port", "operations"],
        &["vessel", "traffic", "service"],
        &["harbormaster"],
        &["harbourmaster"],
        &["harbor", "master"],
        &["harbour", "master"],
    ];
    ADDRESSES.iter().any(|address| words.starts_with(address))
        || contains_phrase(words, &["requesting", "permission", "to", "enter", "port"])
        || contains_phrase(words, &["requesting", "berthing", "instructions"])
}

#[cfg(test)]
mod tests {
    use super::classify;

    #[test]
    fn explicit_priority_calls_override_profile_context() {
        for (text, kind) in [
            (
                "Mayday, Mayday, Mayday. This is the sailing vessel Example.",
                "distress",
            ),
            ("MAY DAY. This is Example, taking on water.", "distress"),
            (
                "[radio static] Mayday, mayday. This is not a drill.",
                "distress",
            ),
            ("Pan-pan, pan pan, pan-pan. All stations.", "urgency"),
            ("PANPAN, requesting assistance.", "urgency"),
            (
                "Sécurité, sécurité, sécurité. Navigation warning.",
                "safety",
            ),
            ("SECURITE, all stations.", "safety"),
            ("Security, security, security. All ships.", "safety"),
        ] {
            assert_eq!(classify(Some(text), "port"), (kind, "transcript"), "{text}");
        }
    }

    #[test]
    fn mentions_names_and_exercises_do_not_become_priority_calls() {
        for text in [
            "Company Japan is inbound.",
            "Pan to the west.",
            "Peter Pan calling.",
            "May Day is a holiday.",
            "It is May Day.",
            "Mayday Parade is inbound.",
            "We heard a mayday last night.",
            "There is no distress.",
            "Security team to the gate.",
            "Mayday means you need help.",
            "Mayday, mayday. This is a drill.",
            "Mayday, mayday. This is only a test.",
            "Mayday, mayday. End of mayday.",
            "Mayday, mayday. The vessel is not in distress.",
            "PAN-PAN. This is a radio check.",
            "Mayday cancelled.",
            "Sécurité training starts at noon.",
        ] {
            assert_eq!(
                classify(Some(text), "unknown"),
                ("unknown", "unknown"),
                "{text}"
            );
        }
    }

    #[test]
    fn explicit_port_calls_and_routine_channel_context_have_distinct_sources() {
        assert_eq!(
            classify(Some("Harbor master, this is Example."), "commercial"),
            ("port", "transcript")
        );
        assert_eq!(
            classify(Some("Our port engine is ready."), "port"),
            ("port", "channel")
        );
        assert_eq!(
            classify(Some("I heard port control yesterday."), "unknown"),
            ("unknown", "unknown")
        );
        assert_eq!(classify(None, "commercial"), ("commercial", "channel"));
        assert_eq!(classify(Some(""), "other"), ("other", "channel"));
        assert_eq!(classify(None, "distress"), ("unknown", "unknown"));
    }
}
