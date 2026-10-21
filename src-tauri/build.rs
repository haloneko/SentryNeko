fn main() {
    // `tauri_build` watches the configuration but not the icon files, so regenerating `icons/`
    // alone left the executable and the window wearing the previous glyph until a source file
    // happened to change. Naming them here makes `pnpm icons` enough on its own.
    for icon in [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.png",
        "icons/icon.ico",
    ] {
        println!("cargo:rerun-if-changed={icon}");
    }

    tauri_build::build();
}
