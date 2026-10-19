//! The version this build reports.
//!
//! It is written into the binary when the crate is compiled, so the backend always answers the same
//! number without reading a file or a database. `package.json` and `tauri.conf.json` carry the same
//! number, and the test below fails if the three ever drift apart.

/// The program's own version, taken from `Cargo.toml` when the crate is compiled.
pub const PROGRAM_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    fn version_in(path: &Path) -> String {
        let contents = std::fs::read_to_string(path).expect("the file is readable");
        let document: serde_json::Value = serde_json::from_str(&contents).expect("json");

        document["version"]
            .as_str()
            .expect("the version is a string")
            .to_owned()
    }

    #[test]
    fn the_three_declared_version_numbers_agree() {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));

        assert_eq!(
            version_in(&manifest.join("tauri.conf.json")),
            PROGRAM_VERSION,
            "the packaged application would report another version"
        );
        assert_eq!(
            version_in(&manifest.join("../package.json")),
            PROGRAM_VERSION,
            "the frontend bundle would report another version"
        );
    }
}
