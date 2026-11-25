fn main() {
    println!("cargo:rerun-if-changed=src/pdf.m");
    println!("cargo:rerun-if-changed=native/movie.m");
    println!("cargo:rerun-if-changed=native/color-sampler.m");
    println!("cargo:rerun-if-changed=native/text-fonts.m");
    cc::Build::new()
        .file("src/pdf.m")
        .file("native/text-fonts.m")
        .file("native/movie.m")
        .file("native/color-sampler.m")
        .flag("-fobjc-arc")
        .flag("-Wno-deprecated-declarations")
        .compile("pp_pdf");
    for framework in [
        "AppKit",
        "WebKit",
        "CoreGraphics",
        "CoreMedia",
        "CoreText",
        "AVFoundation",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    println!("cargo:rerun-if-changed=native/gestures.m");
    cc::Build::new()
        .file("native/gestures.m")
        .flag("-fobjc-arc")
        .compile("pure_point_gestures");
    tauri_build::build()
}
