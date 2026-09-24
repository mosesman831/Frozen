//! Rule normalization and matching (spec §13).
//!
//! Normalization happens at *write* time; matchers work on already-normalized
//! values so evaluation is cheap.

use serde_json::Value;

/// Canonicalize a host: lowercase, strip scheme/creds/port/path/trailing dot.
pub fn canonical_host(input: &str) -> String {
    let mut s = input.trim().to_lowercase();
    // strip scheme
    if let Some(pos) = s.find("://") {
        s = s[pos + 3..].to_string();
    }
    // strip credentials
    if let Some(pos) = s.rfind('@') {
        s = s[pos + 1..].to_string();
    }
    // strip path/query/fragment
    for c in ['/', '?', '#'] {
        if let Some(pos) = s.find(c) {
            s = s[..pos].to_string();
        }
    }
    // strip port
    if let Some(pos) = s.rfind(':') {
        if s[pos + 1..].chars().all(|c| c.is_ascii_digit()) {
            s = s[..pos].to_string();
        }
    }
    s.trim_end_matches('.').to_string()
}

/// Strip a leading `www.` so `domain` rules match the bare form too.
fn strip_www(host: &str) -> &str {
    host.strip_prefix("www.").unwrap_or(host)
}

/// Normalize a rule value for storage, given its kind name.
pub fn normalize_rule(kind: &str, value: &str) -> Result<String, String> {
    let v = value.trim();
    if v.is_empty() {
        return Err("empty rule".into());
    }
    Ok(match kind {
        "domain" => {
            let h = strip_www(&canonical_host(v)).to_string();
            if h.is_empty() {
                return Err("empty domain".into());
            }
            h
        }
        "wildcard" | "url" | "path" | "keyword" | "regex" | "title"
        | "yt-channel" | "yt_channel" => v.to_lowercase(),
        "app" | "folder" => v.to_lowercase().replace('/', "\\"),
        _ => return Err(format!("unknown rule kind: {kind}")),
    })
}

/// Convert a wildcard pattern (with `*`/`?`) to a regex string.
fn wildcard_regex(pat: &str) -> String {
    let mut re = String::with_capacity(pat.len() * 2);
    re.push('^');
    for c in pat.chars() {
        match c {
            '*' => re.push_str(".*"),
            '?' => re.push('.'),
            c if c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_' || c == ':' => {
                re.push(c)
            }
            c => {
                re.push('\\');
                re.push(c);
            }
        }
    }
    re.push('$');
    re
}

/// The decision for a URL/title/app being evaluated.
#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    Allow,
    Block { block_id: String, rule: String },
}

/// Extract (host, path) from a URL for matching.
pub fn split_url(url: &str) -> (String, String) {
    let mut s = url.trim().to_lowercase();
    if let Some(pos) = s.find("://") {
        s = s[pos + 3..].to_string();
    }
    if let Some(pos) = s.find('#') {
        s = s[..pos].to_string();
    }
    let (host_part, path_part) = match s.find('/') {
        Some(pos) => (s[..pos].to_string(), s[pos..].to_string()),
        None => (s.clone(), String::new()),
    };
    (canonical_host(&host_part), path_part)
}

/// Evaluate a URL against a set of rules.
/// `rules` are (kind, normalized_value, negated). Returns the matching rule's
/// negated flag + normalized value for the first hit.
pub fn match_url(url: &str, rules: &[(String, String, bool)]) -> Option<(String, bool)> {
    let (host, path) = split_url(url);
    let full = format!("{host}{path}");
    for (kind, value, negated) in rules {
        let hit = match kind.as_str() {
            "domain" => {
                let h = strip_www(&host);
                h == value.as_str() || h.ends_with(&format!(".{value}"))
            }
            "wildcard" => regex::Regex::new(&wildcard_regex(value))
                .map(|re| re.is_match(&host))
                .unwrap_or(false),
            "url" => full.starts_with(strip_www(value)),
            "keyword" => full.contains(value.as_str()),
            "path" => regex::Regex::new(&wildcard_regex(value))
                .map(|re| re.is_match(&path))
                .unwrap_or(false),
            "regex" => regex::Regex::new(value).map(|re| re.is_match(url)).unwrap_or(false),
            _ => false,
        };
        if hit {
            return Some((value.clone(), *negated));
        }
    }
    None
}

/// Match a page/window title against `title` + `keyword` rules.
pub fn match_title(title: &str, rules: &[(String, String, bool)]) -> Option<(String, bool)> {
    let t = title.to_lowercase();
    for (kind, value, negated) in rules {
        let hit = match kind.as_str() {
            "title" | "keyword" => {
                regex::Regex::new(&wildcard_regex(value))
                    .map(|re| re.is_match(&t))
                    .unwrap_or_else(|_| t.contains(value.as_str()))
            }
            "regex" => regex::Regex::new(value).map(|re| re.is_match(&t)).unwrap_or(false),
            _ => false,
        };
        if hit {
            return Some((value.clone(), *negated));
        }
    }
    None
}

/// Match a process (exe path + window titles) against app/folder/title rules.
/// `exe_path` is absolute; `titles` are the process's window titles.
pub fn match_process(
    exe_path: &str,
    titles: &[String],
    rules: &[(String, String, bool)],
) -> Option<(String, bool)> {
    let path = exe_path.to_lowercase().replace('/', "\\");
    let base = path.rsplit('\\').next().unwrap_or("").to_string();
    for (kind, value, negated) in rules {
        let hit = match kind.as_str() {
            "app" => {
                if value.contains('\\') {
                    path == *value
                } else {
                    base == *value
                }
            }
            "folder" => path.starts_with(&format!("{}\\", value.trim_end_matches('\\'))),
            "title" => titles
                .iter()
                .any(|t| t.to_lowercase().contains(value.as_str())),
            _ => false,
        };
        if hit {
            return Some((value.clone(), *negated));
        }
    }
    None
}

/// Evaluate a URL against a whole block (exceptions first, spec §13.3).
pub fn block_verdict(
    url: &str,
    block: &crate::proto::BlockInfo,
    all_blocks: &[crate::proto::BlockInfo],
) -> Verdict {
    // whitelist-mode active block: allow only its matches, block everything else
    for b in all_blocks {
        if !b.active || !b.allow_mode {
            continue;
        }
        let rules: Vec<(String, String, bool)> = b
            .rules
            .iter()
            .map(|r| (kind_name(&r.kind), r.value.clone(), r.negated))
            .collect();
        if match_url(url, &rules).is_none() {
            return Verdict::Block { block_id: b.id.clone(), rule: "<whitelist>".into() };
        }
        return Verdict::Allow;
    }
    // exception first, then block rules
    let rules: Vec<(String, String, bool)> = block
        .rules
        .iter()
        .map(|r| (kind_name(&r.kind), r.value.clone(), r.negated))
        .collect();
    let (mut pos, mut neg) = (Vec::new(), Vec::new());
    for r in &rules {
        if r.2 { neg.push(r.clone()) } else { pos.push(r.clone()) }
    }
    if match_url(url, &neg).is_some() {
        return Verdict::Allow;
    }
    if let Some((rule, _)) = match_url(url, &pos) {
        return Verdict::Block { block_id: block.id.clone(), rule };
    }
    Verdict::Allow
}

pub fn kind_name(k: &crate::proto::RuleKind) -> String {
    use crate::proto::RuleKind::*;
    match k {
        Domain => "domain",
        Wildcard => "wildcard",
        Url => "url",
        Keyword => "keyword",
        Regex => "regex",
        Path => "path",
        Title => "title",
        App => "app",
        Folder => "folder",
        YtChannel => "yt-channel",
    }
    .to_string()
}

/// Parse the kind name from string form used in JSON/storage.
pub fn kind_from_name(s: &str) -> Option<crate::proto::RuleKind> {
    use crate::proto::RuleKind::*;
    Some(match s {
        "domain" => Domain,
        "wildcard" => Wildcard,
        "url" => Url,
        "keyword" => Keyword,
        "regex" => Regex,
        "path" => Path,
        "title" => Title,
        "app" => App,
        "folder" => Folder,
        "yt-channel" | "yt_channel" => YtChannel,
        _ => return None,
    })
}

/// Serialize a rule tuple list into a JSON array for storage/push.
pub fn rules_to_json(rules: &[(String, String, bool)]) -> Value {
    Value::Array(
        rules
            .iter()
            .map(|(k, v, n)| serde_json::json!({"kind": k, "value": v, "negated": n}))
            .collect(),
    )
}
