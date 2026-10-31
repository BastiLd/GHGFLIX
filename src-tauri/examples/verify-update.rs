//! Read-only signature verification. Never runs or installs an update.
use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use std::{env, fs};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))?;
    let decode = |encoded: &str| -> Result<String, Box<dyn std::error::Error>> {
        Ok(String::from_utf8(base64::engine::general_purpose::STANDARD.decode(encoded.trim())?)?)
    };
    let key = PublicKey::decode(&decode(config["plugins"]["updater"]["pubkey"].as_str().ok_or("Missing key")?)?)?;
    let paths: Vec<_> = env::args().skip(1).collect();
    if paths.is_empty() { return Err("Pass signed installer paths".into()); }
    for path in paths {
        let data = fs::read(&path)?;
        let signature = Signature::decode(&decode(&fs::read_to_string(format!("{path}.sig"))?)?)?;
        key.verify(&data, &signature, true)?;
        let mut corrupt = data;
        if corrupt.is_empty() { return Err("Empty installer".into()); }
        corrupt[0] ^= 1;
        if key.verify(&corrupt, &signature, true).is_ok() { return Err("Corruption was not rejected".into()); }
        println!("Verified {path}; tampered bytes rejected");
    }
    Ok(())
}
