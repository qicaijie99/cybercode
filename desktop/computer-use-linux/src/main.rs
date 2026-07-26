#[cfg(target_os = "linux")]
mod linux {
    use std::{
        env, fs,
        io::Cursor,
        path::{Path, PathBuf},
        process::Command,
        time::{Duration, SystemTime},
    };

    use ashpd::desktop::screenshot::{AvailableTargets, Screenshot};
    use base64::{engine::general_purpose, Engine as _};
    use image::{codecs::jpeg::JpegEncoder, DynamicImage, GenericImageView, ImageFormat};
    use serde::Serialize;
    use serde_json::{json, Value};

    const RECENT_CAPTURE_TTL: Duration = Duration::from_secs(3);

    #[derive(Debug)]
    pub(super) struct HelperFailure {
        code: &'static str,
        message: String,
    }

    impl HelperFailure {
        fn new(code: &'static str, message: impl Into<String>) -> Self {
            Self {
                code,
                message: message.into(),
            }
        }
    }

    #[derive(Serialize)]
    struct ErrorBody<'a> {
        code: &'a str,
        message: &'a str,
    }

    #[derive(Serialize)]
    struct ErrorEnvelope<'a> {
        ok: bool,
        error: ErrorBody<'a>,
    }

    #[derive(Serialize)]
    struct SuccessEnvelope<T: Serialize> {
        ok: bool,
        result: T,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct DisplayGeometry {
        id: u32,
        display_id: u32,
        width: u32,
        height: u32,
        scale_factor: f64,
        origin_x: i32,
        origin_y: i32,
        is_primary: bool,
        name: String,
        label: String,
    }

    fn fail(code: &'static str, message: impl Into<String>) -> HelperFailure {
        HelperFailure::new(code, message)
    }

    fn write_json<T: Serialize>(value: &T) {
        match serde_json::to_string(value) {
            Ok(encoded) => println!("{encoded}"),
            Err(_) => println!(
                r#"{{"ok":false,"error":{{"code":"json_error","message":"Failed to encode helper response"}}}}"#
            ),
        }
    }

    fn payload() -> Result<Value, HelperFailure> {
        let args = env::args().collect::<Vec<_>>();
        let Some(index) = args.iter().position(|arg| arg == "--payload") else {
            return Ok(json!({}));
        };
        let encoded = args
            .get(index + 1)
            .ok_or_else(|| fail("invalid_payload", "Missing value after --payload"))?;
        let value: Value = serde_json::from_str(encoded)
            .map_err(|error| fail("invalid_payload", error.to_string()))?;
        if !value.is_object() {
            return Err(fail("invalid_payload", "Payload must be a JSON object"));
        }
        Ok(value)
    }

    fn number(value: &Value, key: &str) -> Option<f64> {
        value.get(key).and_then(Value::as_f64)
    }

    fn integer(value: &Value, key: &str) -> Option<i64> {
        value.get(key).and_then(Value::as_i64)
    }

    fn string(value: &Value, key: &str) -> Option<String> {
        value.get(key).and_then(Value::as_str).map(str::to_owned)
    }

    fn cache_dir() -> PathBuf {
        env::var_os("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(env::temp_dir)
            .join("cybercode-computer-use")
    }

    fn cached_capture_path() -> PathBuf {
        cache_dir().join("latest-screen.png")
    }

    fn cache_is_recent(path: &Path) -> bool {
        fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .and_then(|modified| {
                SystemTime::now()
                    .duration_since(modified)
                    .map_err(std::io::Error::other)
            })
            .map(|age| age <= RECENT_CAPTURE_TTL)
            .unwrap_or(false)
    }

    fn read_cached_capture(recent_only: bool) -> Option<DynamicImage> {
        let path = cached_capture_path();
        if recent_only && !cache_is_recent(&path) {
            return None;
        }
        image::open(path).ok()
    }

    fn store_cached_capture(image: &DynamicImage) {
        let directory = cache_dir();
        if fs::create_dir_all(&directory).is_err() {
            return;
        }
        let path = cached_capture_path();
        let temporary = directory.join(format!("latest-screen-{}.tmp", std::process::id()));
        if image.save_with_format(&temporary, ImageFormat::Png).is_ok() {
            let _ = fs::rename(temporary, path);
        }
    }

    fn command_available(command: &str) -> bool {
        let Some(paths) = env::var_os("PATH") else {
            return false;
        };
        env::split_paths(&paths).any(|path| path.join(command).is_file())
    }

    fn run_capture_command(
        command: &str,
        args: &[&str],
        output_path: &Path,
    ) -> Result<DynamicImage, HelperFailure> {
        let output = Command::new(command)
            .args(args)
            .arg(output_path)
            .output()
            .map_err(|error| fail("capture_backend_failed", error.to_string()))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            return Err(fail(
                "capture_backend_failed",
                if detail.is_empty() {
                    format!("{command} exited with {}", output.status)
                } else {
                    format!("{command}: {detail}")
                },
            ));
        }
        image::open(output_path).map_err(|error| fail("capture_decode_failed", error.to_string()))
    }

    fn capture_with_system_tool() -> Result<DynamicImage, HelperFailure> {
        let directory = cache_dir();
        fs::create_dir_all(&directory)
            .map_err(|error| fail("capture_cache_failed", error.to_string()))?;
        let output_path = directory.join(format!("system-capture-{}.png", std::process::id()));
        let result = if command_available("grim") {
            run_capture_command("grim", &[], &output_path)
        } else if command_available("gnome-screenshot") {
            run_capture_command("gnome-screenshot", &["-f"], &output_path)
        } else if command_available("spectacle") {
            run_capture_command(
                "spectacle",
                &["--background", "--nonotify", "--output"],
                &output_path,
            )
        } else if command_available("scrot") {
            run_capture_command("scrot", &[], &output_path)
        } else if command_available("import") {
            run_capture_command("import", &["-window", "root"], &output_path)
        } else {
            Err(fail(
                "capture_backend_unavailable",
                "No X11 screenshot backend is available",
            ))
        };
        let _ = fs::remove_file(output_path);
        result
    }

    async fn capture_with_portal() -> Result<DynamicImage, HelperFailure> {
        let request = Screenshot::request()
            .interactive(false)
            .target(AvailableTargets::Screen)
            .send()
            .await
            .map_err(|error| {
                fail(
                    "portal_unavailable",
                    format!("Linux screenshot portal is unavailable: {error}"),
                )
            })?;
        let response = request.response().map_err(|error| {
            let message = error.to_string();
            let code = if message.to_ascii_lowercase().contains("cancel") {
                "SCREEN_CAPTURE_CANCELLED"
            } else {
                "SCREEN_CAPTURE_PERMISSION_REQUIRED"
            };
            fail(
                code,
                format!("Linux screen capture was not approved: {message}"),
            )
        })?;
        let uri = url::Url::parse(response.uri().as_str())
            .map_err(|error| fail("portal_invalid_uri", error.to_string()))?;
        let path = uri.to_file_path().map_err(|_| {
            fail(
                "portal_invalid_uri",
                format!("Screenshot portal returned a non-file URI: {uri}"),
            )
        })?;
        let image =
            image::open(&path).map_err(|error| fail("capture_decode_failed", error.to_string()))?;
        let _ = fs::remove_file(path);
        Ok(image)
    }

    async fn capture_fresh() -> Result<DynamicImage, HelperFailure> {
        let wayland = env::var_os("WAYLAND_DISPLAY").is_some()
            || env::var("XDG_SESSION_TYPE")
                .map(|value| value.eq_ignore_ascii_case("wayland"))
                .unwrap_or(false);

        let image = if wayland {
            match capture_with_portal().await {
                Ok(image) => Ok(image),
                Err(portal_error) => capture_with_system_tool().map_err(|tool_error| {
                    fail(
                        portal_error.code,
                        format!("{}; {}", portal_error.message, tool_error.message),
                    )
                }),
            }
        } else {
            match capture_with_system_tool() {
                Ok(image) => Ok(image),
                Err(tool_error) => capture_with_portal().await.map_err(|portal_error| {
                    fail(
                        portal_error.code,
                        format!("{}; {}", tool_error.message, portal_error.message),
                    )
                }),
            }
        }?;
        store_cached_capture(&image);
        Ok(image)
    }

    async fn capture(reuse_recent: bool) -> Result<DynamicImage, HelperFailure> {
        if reuse_recent {
            if let Some(image) = read_cached_capture(true) {
                return Ok(image);
            }
        }
        capture_fresh().await
    }

    async fn geometry() -> Result<DisplayGeometry, HelperFailure> {
        let image = match read_cached_capture(true) {
            Some(image) => image,
            None => capture_fresh().await?,
        };
        let (width, height) = image.dimensions();
        Ok(DisplayGeometry {
            id: 0,
            display_id: 0,
            width,
            height,
            scale_factor: 1.0,
            origin_x: 0,
            origin_y: 0,
            is_primary: true,
            name: "Linux Desktop".to_string(),
            label: "Linux Desktop".to_string(),
        })
    }

    fn validate_display(payload: &Value, key: &str) -> Result<(), HelperFailure> {
        if let Some(display_id) = integer(payload, key) {
            if display_id != 0 {
                return Err(fail(
                    "unknown_display",
                    format!("Unknown Linux desktop display: {display_id}"),
                ));
            }
        }
        Ok(())
    }

    fn resize(image: DynamicImage, payload: &Value) -> DynamicImage {
        let width = integer(payload, "targetWidth").and_then(|value| u32::try_from(value).ok());
        let height = integer(payload, "targetHeight").and_then(|value| u32::try_from(value).ok());
        match (width, height) {
            (Some(width), Some(height)) if width > 0 && height > 0 => {
                image.resize_exact(width, height, image::imageops::FilterType::Lanczos3)
            }
            _ => image,
        }
    }

    fn encode_jpeg(image: &DynamicImage, quality: u8) -> Result<String, HelperFailure> {
        let mut bytes = Vec::new();
        JpegEncoder::new_with_quality(&mut bytes, quality)
            .encode_image(image)
            .map_err(|error| fail("encode_failed", error.to_string()))?;
        Ok(general_purpose::STANDARD.encode(bytes))
    }

    fn screenshot_result(
        image: DynamicImage,
        payload: &Value,
        display: &DisplayGeometry,
    ) -> Result<Value, HelperFailure> {
        let image = resize(image, payload);
        let quality = number(payload, "jpegQuality")
            .map(|value| (value.clamp(0.0, 1.0) * 100.0).round() as u8)
            .unwrap_or(75);
        Ok(json!({
            "base64": encode_jpeg(&image, quality)?,
            "width": image.width(),
            "height": image.height(),
            "displayWidth": display.width,
            "displayHeight": display.height,
            "displayId": display.display_id,
            "originX": display.origin_x,
            "originY": display.origin_y,
            "display": display,
        }))
    }

    fn crop_region(image: &DynamicImage, payload: &Value) -> Result<DynamicImage, HelperFailure> {
        let x = number(payload, "x").unwrap_or(0.0).round() as i64;
        let y = number(payload, "y").unwrap_or(0.0).round() as i64;
        let width = integer(payload, "width")
            .and_then(|value| u32::try_from(value).ok())
            .filter(|value| *value > 0)
            .ok_or_else(|| fail("invalid_region", "Capture width must be positive"))?;
        let height = integer(payload, "height")
            .and_then(|value| u32::try_from(value).ok())
            .filter(|value| *value > 0)
            .ok_or_else(|| fail("invalid_region", "Capture height must be positive"))?;

        if image.width() == width && image.height() == height {
            return Ok(image.clone());
        }

        let origin_x = integer(payload, "desktopOriginX").unwrap_or(0);
        let origin_y = integer(payload, "desktopOriginY").unwrap_or(0);
        let local_x = x.saturating_sub(origin_x).max(0) as u32;
        let local_y = y.saturating_sub(origin_y).max(0) as u32;
        if local_x >= image.width() || local_y >= image.height() {
            return Err(fail(
                "invalid_region",
                "Capture region is outside the portal screenshot",
            ));
        }
        let cropped_width = width.min(image.width() - local_x);
        let cropped_height = height.min(image.height() - local_y);
        Ok(image.crop_imm(local_x, local_y, cropped_width, cropped_height))
    }

    fn save_png(image: &DynamicImage, output_path: &Path) -> Result<(), HelperFailure> {
        let mut bytes = Cursor::new(Vec::new());
        image
            .write_to(&mut bytes, ImageFormat::Png)
            .map_err(|error| fail("encode_failed", error.to_string()))?;
        let temporary = output_path.with_extension(format!("{}.tmp", std::process::id()));
        fs::write(&temporary, bytes.into_inner())
            .map_err(|error| fail("write_failed", error.to_string()))?;
        fs::rename(&temporary, output_path).map_err(|error| fail("write_failed", error.to_string()))
    }

    fn backend_status() -> Value {
        let wayland = env::var_os("WAYLAND_DISPLAY").is_some()
            || env::var("XDG_SESSION_TYPE")
                .map(|value| value.eq_ignore_ascii_case("wayland"))
                .unwrap_or(false);
        let has_session =
            env::var_os("DISPLAY").is_some() || env::var_os("WAYLAND_DISPLAY").is_some();
        json!({
            "screenCapture": has_session,
            "screenRecording": has_session,
            "backend": if wayland { "xdg-desktop-portal" } else { "x11-or-portal" },
            "requiresUserConfirmation": wayland,
        })
    }

    pub async fn run() -> Result<Value, HelperFailure> {
        let args = env::args().collect::<Vec<_>>();
        let command = args
            .get(1)
            .ok_or_else(|| fail("missing_command", "A helper command is required"))?;
        let payload = payload()?;

        match command.as_str() {
            "check_screen_capture" | "check_screen_recording" => Ok(backend_status()),
            "request_screen_capture" | "request_screen_recording" => Ok(backend_status()),
            "list_displays" => Ok(json!([geometry().await?])),
            "get_display_size" => {
                validate_display(&payload, "displayId")?;
                Ok(json!(geometry().await?))
            }
            "screenshot" => {
                validate_display(&payload, "displayId")?;
                let display = geometry().await?;
                screenshot_result(capture(true).await?, &payload, &display)
            }
            "resolve_prepare_capture" => {
                validate_display(&payload, "preferredDisplayId")?;
                let display = geometry().await?;
                let mut result = screenshot_result(capture(true).await?, &payload, &display)?;
                if let Some(object) = result.as_object_mut() {
                    object.insert("hidden".to_string(), json!([]));
                    object.insert("resolvedDisplayId".to_string(), json!(0));
                }
                Ok(result)
            }
            "zoom" => {
                let image = crop_region(&capture(false).await?, &payload)?;
                let image = resize(image, &payload);
                Ok(json!({
                    "base64": encode_jpeg(&image, 75)?,
                    "width": image.width(),
                    "height": image.height(),
                }))
            }
            "capture_png_to_file" => {
                let output_path = string(&payload, "outputPath")
                    .filter(|value| !value.is_empty())
                    .map(PathBuf::from)
                    .ok_or_else(|| fail("invalid_region", "outputPath is required"))?;
                let image = crop_region(&capture(false).await?, &payload)?;
                save_png(&image, &output_path)?;
                Ok(json!({
                    "path": output_path,
                    "width": image.width(),
                    "height": image.height(),
                }))
            }
            _ => Err(fail(
                "unknown_command",
                format!("Unknown Computer Use helper command: {command}"),
            )),
        }
    }

    pub fn print_result(result: Result<Value, HelperFailure>) -> i32 {
        match result {
            Ok(result) => {
                write_json(&SuccessEnvelope { ok: true, result });
                0
            }
            Err(error) => {
                write_json(&ErrorEnvelope {
                    ok: false,
                    error: ErrorBody {
                        code: error.code,
                        message: &error.message,
                    },
                });
                1
            }
        }
    }
}

#[cfg(target_os = "linux")]
#[tokio::main]
async fn main() {
    let code = linux::print_result(linux::run().await);
    std::process::exit(code);
}

#[cfg(not(target_os = "linux"))]
fn main() {
    println!(
        r#"{{"ok":false,"error":{{"code":"unsupported_platform","message":"This helper only runs on Linux"}}}}"#
    );
    std::process::exit(1);
}
