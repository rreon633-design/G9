//! Tiny XML/HTML text helpers. No parser dependency: feeds, manifests and
//! MangaDex JSON are the only shapes Fun Mode reads, and all three stay small.

/// Decode the five XML entities plus numeric references.
pub fn unescape(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'&' {
            if let Some(end) = raw[i..].find(';').map(|p| i + p) {
                if end - i <= 10 {
                    let ent = &raw[i + 1..end];
                    let rep = match ent {
                        "amp" => Some('&'),
                        "lt" => Some('<'),
                        "gt" => Some('>'),
                        "quot" => Some('"'),
                        "apos" => Some('\''),
                        "nbsp" => Some(' '),
                        _ => {
                            if let Some(hex) = ent.strip_prefix("#x").or(ent.strip_prefix("#X")) {
                                u32::from_str_radix(hex, 16).ok().and_then(char::from_u32)
                            } else if let Some(dec) = ent.strip_prefix('#') {
                                dec.parse::<u32>().ok().and_then(char::from_u32)
                            } else {
                                None
                            }
                        }
                    };
                    if let Some(c) = rep {
                        out.push(c);
                        i = end + 1;
                        continue;
                    }
                }
            }
        }
        // Safe: multi-byte characters only ever start with a continuation byte
        // that is not `&`, so pushing the raw char here keeps UTF-8 intact.
        let ch = raw[i..].chars().next().unwrap_or(' ');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

/// Strip tags, collapse whitespace, unescape entities.
pub fn text_of(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_tag = false;
    for c in raw.chars() {
        match c {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let un = unescape(&out);
    un.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// First year-like 4-digit run (`1998`…`2099`) anywhere in the string. RSS dates
/// are RFC-822 (`Sat, 25 Oct 2025 …`), so a prefix parse is not enough.
pub fn year_of(raw: &str) -> Option<i32> {
    let b = raw.as_bytes();
    for i in 0..b.len().saturating_sub(3) {
        if !b[i].is_ascii_digit() {
            continue;
        }
        if i > 0 && b[i - 1].is_ascii_digit() {
            continue;
        }
        let w = &b[i..i + 4];
        if w.iter().all(u8::is_ascii_digit) {
            let y = std::str::from_utf8(w).ok()?.parse::<i32>().ok()?;
            if (1900..2100).contains(&y) {
                return Some(y);
            }
        }
    }
    None
}

/// Inner text of the first `<tag …>…</tag>` in `raw`, unescaped and trimmed.
pub fn tag_text(raw: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}");
    let start = raw.find(&open)?;
    let after = raw[start..].find('>')? + start + 1;
    let close = raw[after..].find(&format!("</{tag}>"))? + after;
    Some(text_of(&raw[after..close]))
}

/// Inner text of **all** `<tag>` occurrences, in document order.
pub fn tag_texts(raw: &str, tag: &str) -> Vec<String> {
    let mut out = Vec::new();
    let close = format!("</{tag}>");
    let open = format!("<{tag}");
    let mut rest = raw;
    while let Some(s) = rest.find(&open) {
        let tail = &rest[s..];
        let Some(gt) = tail.find('>') else { break };
        let body = &tail[gt + 1..];
        let Some(end) = body.find(&close) else { break };
        out.push(text_of(&body[..end]));
        rest = &body[end + close.len()..];
    }
    out
}

/// Read an attribute (`key="value"`) from the first `<tag …>` element.
pub fn attr(raw: &str, tag: &str, key: &str) -> Option<String> {
    let start = raw.find(&format!("<{tag}"))?;
    let tail = &raw[start..];
    let gt = tail.find('>')?;
    let head = &tail[..gt];
    let needle = format!("{key}=");
    let at = head.find(&needle)? + needle.len();
    let rest = &head[at..];
    let quote = rest.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let end = rest[1..].find(quote)? + 1;
    Some(unescape(&rest[1..end]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unescape_handles_named_and_numeric() {
        assert_eq!(unescape("a &amp; b &lt;c&gt; &#65;"), "a & b <c> A");
    }

    #[test]
    fn text_of_strips_tags_and_collapses() {
        assert_eq!(text_of("<b>Hello</b>\n   world"), "Hello world");
    }

    #[test]
    fn year_of_finds_rfc822_and_iso() {
        assert_eq!(year_of("Sat, 25 Oct 2025 09:00:00 -0000"), Some(2025));
        assert_eq!(year_of("2021-2022"), Some(2021));
        assert_eq!(year_of("no date"), None);
        assert_eq!(year_of("1234567"), None);
    }

    #[test]
    fn tag_helpers_read_nested_values() {
        let xml = r#"<item><title>One &amp; Two</title><nyaa:seeders>38</nyaa:seeders></item>"#;
        assert_eq!(tag_text(xml, "title").as_deref(), Some("One & Two"));
        assert_eq!(tag_text(xml, "nyaa:seeders").as_deref(), Some("38"));
        assert_eq!(
            attr(r#"<link href="x" />"#, "link", "href").as_deref(),
            Some("x")
        );
    }
}
