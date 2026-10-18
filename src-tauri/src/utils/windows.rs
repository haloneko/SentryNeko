//! Win32 FFI declarations and safe wrappers. All platform-specific code lives here.
//!
//! The calls are declared by hand instead of pulling in the `windows` crate: the collectors need
//! a handful of them, and a hand-written binding keeps the dependency list short.

use std::ffi::c_void;
use std::ptr;

use crate::utils::response::{ApiError, ApiResult};

/// `LOGFONTW`, with a 32-code-unit family name. Layout must match `wingdi.h`.
#[repr(C)]
#[derive(Default)]
struct LogFont {
    height: i32,
    width: i32,
    escapement: i32,
    orientation: i32,
    weight: i32,
    italic: u8,
    underline: u8,
    strike_out: u8,
    char_set: u8,
    out_precision: u8,
    clip_precision: u8,
    quality: u8,
    pitch_and_family: u8,
    face_name: [u16; 32],
}

/// Opaque handle type: `HWND` for windows, `HANDLE` for kernel objects.
type Handle = *mut c_void;

/// A window handle (`HWND`).
type WindowHandle = Handle;

/// Lets the caller read a process that runs at a higher integrity level.
const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

/// Longest image path `QueryFullProcessImageNameW` returns, in UTF-16 code units.
const MAX_IMAGE_PATH_UNITS: usize = 32_768;

/// 100-nanosecond intervals between 1601-01-01 (`FILETIME` origin) and 1970-01-01.
const UNIX_EPOCH_IN_FILETIME: u64 = 116_444_736_000_000_000;

/// 100-nanosecond intervals in one second.
const FILETIME_PER_SECOND: u64 = 10_000_000;

/// `SYSTEMTIME`: a broken-down local or universal time, as Windows reports it.
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
struct SystemTime {
    year: u16,
    month: u16,
    day_of_week: u16,
    day: u16,
    hour: u16,
    minute: u16,
    second: u16,
    milliseconds: u16,
}

/// `FILETIME`: 100-nanosecond intervals since 1601-01-01, split into two words.
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
struct FileTime {
    low: u32,
    high: u32,
}

/// `LASTINPUTINFO`: when the last keyboard or mouse input arrived, on the tick clock.
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
struct LastInputInfo {
    size: u32,
    tick: u32,
}

/// `MB_ICONASTERISK`: the chime Windows plays for an informational alert.
const MB_ICONASTERISK: u32 = 0x0000_0040;

/// A registry key handle (`HKEY`).
type Hkey = isize;

/// `HKEY_CURRENT_USER`, sign-extended the way Windows defines its predefined handles.
const HKEY_CURRENT_USER: Hkey = 0x8000_0001u32 as i32 as Hkey;

/// Per-user run key: what Windows starts for this account when it signs in.
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

const KEY_QUERY_VALUE: u32 = 0x0001;
const KEY_SET_VALUE: u32 = 0x0002;
const REG_SZ: u32 = 1;
const ERROR_SUCCESS: i32 = 0;
const ERROR_FILE_NOT_FOUND: i32 = 2;

#[link(name = "user32")]
extern "system" {
    fn GetDC(window: WindowHandle) -> Handle;
    fn ReleaseDC(window: WindowHandle, context: Handle) -> i32;
    fn GetForegroundWindow() -> WindowHandle;
    fn MessageBeep(sound: u32) -> i32;
    fn IsWindowVisible(window: WindowHandle) -> i32;
    fn GetWindowTextLengthW(window: WindowHandle) -> i32;
    fn GetWindowTextW(window: WindowHandle, buffer: *mut u16, capacity: i32) -> i32;
    fn GetWindowThreadProcessId(window: WindowHandle, process_id: *mut u32) -> u32;
}

#[link(name = "gdi32")]
extern "system" {
    fn EnumFontFamiliesExW(
        context: Handle,
        filter: *const LogFont,
        callback: unsafe extern "system" fn(*const LogFont, *const c_void, u32, isize) -> i32,
        parameter: isize,
        flags: u32,
    ) -> i32;
}

/// Sorted, unique family names available to the current Windows user.
pub fn system_font_families() -> ApiResult<Vec<String>> {
    let context = unsafe { GetDC(ptr::null_mut()) };

    if context.is_null() {
        return Err(
            ApiError::internal("cannot create a font enumeration context")
                .with_details(std::io::Error::last_os_error().to_string()),
        );
    }

    // DEFAULT_CHARSET (1) and an empty name enumerate every family, across writing systems.
    let filter = LogFont {
        char_set: 1,
        ..LogFont::default()
    };
    let mut families = Vec::<String>::new();

    unsafe {
        // Enumeration is synchronous: the vector stays alive and exclusively borrowed here.
        EnumFontFamiliesExW(
            context,
            &filter,
            collect_font_family,
            &mut families as *mut Vec<String> as isize,
            0,
        );
        ReleaseDC(ptr::null_mut(), context);
    }

    families.sort_by_cached_key(|family| family.to_lowercase());
    families.dedup_by(|left, right| left.to_lowercase() == right.to_lowercase());

    if families.is_empty() {
        return Err(ApiError::internal(
            "Windows did not report any installed font families",
        ));
    }

    Ok(families)
}

unsafe extern "system" fn collect_font_family(
    font: *const LogFont,
    _metrics: *const c_void,
    _font_type: u32,
    parameter: isize,
) -> i32 {
    // Windows supplies a LOGFONTW at the start of its extended font structure.
    let name = unsafe { &(*font).face_name };
    let end = name
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(name.len());
    let family = String::from_utf16_lossy(&name[..end]);

    // `@` families are vertical-writing aliases of the same font, unsuitable for the UI.
    if !family.is_empty() && !family.starts_with('@') {
        unsafe { &mut *(parameter as *mut Vec<String>) }.push(family);
    }

    1
}

#[link(name = "kernel32")]
extern "system" {
    fn GetCurrentProcessId() -> u32;
    fn GetTickCount() -> u32;
    fn GetTickCount64() -> u64;
    fn GetLastInputInfo(last_input: *mut LastInputInfo) -> i32;
    fn OpenProcess(access: u32, inherit: i32, process_id: u32) -> Handle;
    fn CloseHandle(handle: Handle) -> i32;
    fn QueryFullProcessImageNameW(
        handle: Handle,
        flags: u32,
        buffer: *mut u16,
        size: *mut u32,
    ) -> i32;
    fn FileTimeToSystemTime(file_time: *const FileTime, system_time: *mut SystemTime) -> i32;
    fn SystemTimeToFileTime(system_time: *const SystemTime, file_time: *mut FileTime) -> i32;
    fn SystemTimeToTzSpecificLocalTime(
        zone: *const c_void,
        universal: *const SystemTime,
        local: *mut SystemTime,
    ) -> i32;
    fn TzSpecificLocalTimeToSystemTime(
        zone: *const c_void,
        local: *const SystemTime,
        universal: *mut SystemTime,
    ) -> i32;
}

#[link(name = "advapi32")]
extern "system" {
    fn RegCreateKeyExW(
        key: Hkey,
        sub_key: *const u16,
        reserved: u32,
        class: *const u16,
        options: u32,
        desired: u32,
        security: *const c_void,
        result: *mut Hkey,
        disposition: *mut u32,
    ) -> i32;
    fn RegCloseKey(key: Hkey) -> i32;
    fn RegQueryValueExW(
        key: Hkey,
        name: *const u16,
        reserved: *mut u32,
        kind: *mut u32,
        data: *mut u8,
        bytes: *mut u32,
    ) -> i32;
    fn RegSetValueExW(
        key: Hkey,
        name: *const u16,
        reserved: u32,
        kind: u32,
        data: *const u8,
        bytes: u32,
    ) -> i32;
    fn RegDeleteValueW(key: Hkey, name: *const u16) -> i32;
}

/// A local calendar date, as Windows breaks it down.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalDate {
    pub year: u16,
    pub month: u16,
    pub day: u16,
    /// Day of the week, `0` being Sunday.
    pub weekday: u16,
}

/// The window the user is looking at, as far as the collector cares.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForegroundApp {
    /// Executable file name without its extension, e.g. `chrome`.
    pub app_name: String,
    /// Caption of the window, trimmed; `None` when it is empty.
    pub window_title: Option<String>,
    /// Process that owns the window, so the caller can drop its own windows.
    pub process_id: u32,
}

/// Reads the foreground window.
///
/// Answers `None` when nothing is in front, when the window is hidden, or when Windows refuses to
/// name the process behind it — an elevated window cannot be opened by an ordinary process.
#[must_use]
pub fn foreground_app() -> Option<ForegroundApp> {
    let window = unsafe { GetForegroundWindow() };

    if window.is_null() || unsafe { IsWindowVisible(window) } == 0 {
        return None;
    }

    let process_id = process_id_of(window)?;
    let image = process_image_name(process_id)?;

    Some(ForegroundApp {
        app_name: executable_name(&image)?,
        window_title: window_title(window),
        process_id,
    })
}

/// Process id of the running application, so its own windows can be told apart.
#[must_use]
pub fn current_process_id() -> u32 {
    unsafe { GetCurrentProcessId() }
}

/// Executable file name without its extension: `C:\Apps\Code.exe` becomes `Code`.
#[must_use]
pub fn executable_name(image_path: &str) -> Option<String> {
    // A trailing separator marks a directory, whose last component `file_stem` would return.
    if image_path.ends_with(['\\', '/']) {
        return None;
    }

    let name = std::path::Path::new(image_path)
        .file_stem()?
        .to_string_lossy()
        .into_owned();

    (!name.is_empty()).then_some(name)
}

/// Milliseconds the machine has been up.
///
/// `GetTickCount64` follows the interrupt time, which keeps running through sleep and
/// hibernation; a suspend therefore does not shift the boot instant derived from it.
#[must_use]
pub fn milliseconds_since_boot() -> u64 {
    unsafe { GetTickCount64() }
}

/// Milliseconds since the last keyboard or mouse input.
///
/// Answers `None` when Windows cannot report it, which only happens outside an interactive
/// session; the caller then has to decide whether to keep going.
#[must_use]
pub fn milliseconds_since_last_input() -> Option<u64> {
    let mut last = LastInputInfo {
        size: std::mem::size_of::<LastInputInfo>() as u32,
        tick: 0,
    };

    if unsafe { GetLastInputInfo(&mut last) } == 0 {
        return None;
    }

    // Both values ride the same 32-bit tick clock, so the wrapping subtraction survives its
    // 49-day rollover.
    let now = unsafe { GetTickCount() };

    Some(u64::from(now.wrapping_sub(last.tick)))
}

/// Plays the chime Windows uses for an informational alert, once.
///
/// The error is the platform's reason, e.g. when the process has no sound device; the caller
/// decides whether that is worth reporting.
pub fn play_alert() -> Result<(), String> {
    if unsafe { MessageBeep(MB_ICONASTERISK) } == 0 {
        return Err("the system refused to play the alert".to_owned());
    }

    Ok(())
}

/// UTC epoch seconds of the local midnight that starts the day `utc_seconds` falls in.
///
/// The local time is resolved through the Windows time zone rules rather than a stored offset, so
/// the answer stays right on the two days a year the offset changes. `None` when Windows cannot
/// break the instant down.
#[must_use]
pub fn local_midnight(utc_seconds: i64) -> Option<i64> {
    let local = local_time_of(utc_seconds)?;

    let midnight = SystemTime {
        hour: 0,
        minute: 0,
        second: 0,
        milliseconds: 0,
        ..local
    };

    let mut start = SystemTime::default();
    if unsafe { TzSpecificLocalTimeToSystemTime(ptr::null(), &midnight, &mut start) } != 0 {
        if let Some(file_time) = file_time_of(&start) {
            return seconds_since_epoch(file_time);
        }
    }

    // A zone can jump over the midnight hour when its clock moves; the wall clock still says how
    // much of the day has passed, which is close enough for a fallback.
    Some(utc_seconds - seconds_of_day(&local))
}

/// Local calendar date of `utc_seconds`; `None` when Windows cannot break the instant down.
#[must_use]
pub fn local_date(utc_seconds: i64) -> Option<LocalDate> {
    let local = local_time_of(utc_seconds)?;

    Some(LocalDate {
        year: local.year,
        month: local.month,
        day: local.day,
        weekday: local.day_of_week,
    })
}

/// UTC instant at the start of a local calendar date. If a clock change skips midnight, use the
/// first valid hour of that date instead of moving the task to a different day.
#[must_use]
pub fn calendar_midnight(year: u16, month: u16, day: u16) -> Option<i64> {
    for hour in 0..24 {
        let local = SystemTime {
            year,
            month,
            day,
            hour,
            ..SystemTime::default()
        };
        let mut universal = SystemTime::default();
        if unsafe { TzSpecificLocalTimeToSystemTime(ptr::null(), &local, &mut universal) } == 0 {
            continue;
        }
        let instant = seconds_since_epoch(file_time_of(&universal)?)?;
        let roundtrip = local_time_of(instant)?;
        if (
            roundtrip.year,
            roundtrip.month,
            roundtrip.day,
            roundtrip.hour,
        ) == (year, month, day, hour)
        {
            return Some(instant);
        }
    }

    None
}

/// Shifts an instant's local date by calendar months and days, then resolves its local midnight.
/// Month arithmetic clamps the original day to the last day of the target month.
#[must_use]
pub fn shift_local_midnight(anchor: i64, days: i64, months: i64) -> Option<i64> {
    let local = local_time_of(anchor)?;
    let month_index = i64::from(local.year)
        .checked_mul(12)?
        .checked_add(i64::from(local.month) - 1)?
        .checked_add(months)?;
    let year = u16::try_from(month_index.div_euclid(12)).ok()?;
    let month = u16::try_from(month_index.rem_euclid(12) + 1).ok()?;
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let last_day = match month {
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    // Treat this date as UTC only for date arithmetic; applying the zone comes afterwards.
    let date = SystemTime {
        year,
        month,
        day: local.day.min(last_day),
        ..SystemTime::default()
    };
    let naive = seconds_since_epoch(file_time_of(&date)?)?;
    let shifted = system_time_of(naive.checked_add(days.checked_mul(86_400)?)?)?;
    calendar_midnight(shifted.year, shifted.month, shifted.day)
}

/// Minutes the local clock reads on `utc_seconds`, counted from its midnight.
///
/// `None` when Windows cannot break the instant down. The value runs `0..1440` on a normal day and
/// is one of the answers a wall-clock time can have when a clock change repeats an hour.
#[must_use]
pub fn local_minutes(utc_seconds: i64) -> Option<i64> {
    let local = local_time_of(utc_seconds)?;

    Some(seconds_of_day(&local) / 60)
}

/// Process id that owns `window`; `None` when Windows reports none.
fn process_id_of(window: WindowHandle) -> Option<u32> {
    let mut process_id = 0u32;
    unsafe { GetWindowThreadProcessId(window, &mut process_id) };

    (process_id != 0).then_some(process_id)
}

/// Full path of the executable behind `process_id`.
fn process_image_name(process_id: u32) -> Option<String> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };

    if handle.is_null() {
        return None;
    }

    let mut buffer = vec![0u16; MAX_IMAGE_PATH_UNITS];
    let mut written = MAX_IMAGE_PATH_UNITS as u32;
    let read = unsafe { QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut written) };

    unsafe { CloseHandle(handle) };

    if read == 0 {
        return None;
    }

    Some(String::from_utf16_lossy(&buffer[..written as usize]))
}

/// Caption of `window`, trimmed; `None` when the window has none.
fn window_title(window: WindowHandle) -> Option<String> {
    let length = unsafe { GetWindowTextLengthW(window) };

    if length <= 0 {
        return None;
    }

    // The length does not count the terminating NUL, so one more unit is reserved for it.
    let mut buffer = vec![0u16; length as usize + 1];
    let written = unsafe { GetWindowTextW(window, buffer.as_mut_ptr(), buffer.len() as i32) };

    if written <= 0 {
        return None;
    }

    let title = String::from_utf16_lossy(&buffer[..written as usize]);
    let title = title.trim();

    (!title.is_empty()).then(|| title.to_owned())
}

/// Broken-down local time of an epoch instant, in the zone the machine is set to.
fn local_time_of(utc_seconds: i64) -> Option<SystemTime> {
    let universal = system_time_of(utc_seconds)?;
    let mut local = SystemTime::default();

    if unsafe { SystemTimeToTzSpecificLocalTime(ptr::null(), &universal, &mut local) } == 0 {
        return None;
    }

    Some(local)
}

/// Broken-down universal time of an epoch instant.
fn system_time_of(utc_seconds: i64) -> Option<SystemTime> {
    let hundred_nanos = u64::try_from(utc_seconds)
        .ok()?
        .checked_mul(FILETIME_PER_SECOND)?
        .checked_add(UNIX_EPOCH_IN_FILETIME)?;
    let file_time = FileTime {
        low: hundred_nanos as u32,
        high: (hundred_nanos >> 32) as u32,
    };

    let mut system_time = SystemTime::default();
    (unsafe { FileTimeToSystemTime(&file_time, &mut system_time) } != 0).then_some(system_time)
}

/// `FILETIME` of a broken-down time.
fn file_time_of(system_time: &SystemTime) -> Option<FileTime> {
    let mut file_time = FileTime::default();
    (unsafe { SystemTimeToFileTime(system_time, &mut file_time) } != 0).then_some(file_time)
}

/// Epoch seconds of a `FILETIME`; `None` for an instant before 1970.
fn seconds_since_epoch(file_time: FileTime) -> Option<i64> {
    let hundred_nanos = (u64::from(file_time.high) << 32) | u64::from(file_time.low);
    let seconds = hundred_nanos.checked_sub(UNIX_EPOCH_IN_FILETIME)? / FILETIME_PER_SECOND;

    i64::try_from(seconds).ok()
}

/// Seconds since local midnight, ignoring an offset change earlier in the day.
fn seconds_of_day(local: &SystemTime) -> i64 {
    i64::from(local.hour) * 3_600 + i64::from(local.minute) * 60 + i64::from(local.second)
}

/// The command the per-user run key holds under `name`, or `None` when it holds nothing.
///
/// `Err` is the platform's reason: a policy that forbids reading the key, or a value of another
/// type.
pub fn run_at_login(name: &str) -> Result<Option<String>, String> {
    let key = RunKey::open()?;
    let value = wide(name);
    let mut kind = 0;
    let mut bytes = 0;

    // The first call asks for the size, the second fills the buffer.
    let code = unsafe {
        RegQueryValueExW(
            key.0,
            value.as_ptr(),
            ptr::null_mut(),
            &mut kind,
            ptr::null_mut(),
            &mut bytes,
        )
    };

    if code == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }

    if code != ERROR_SUCCESS {
        return Err(format!("RegQueryValueExW failed with code {code}"));
    }

    if kind != REG_SZ || bytes == 0 {
        return Ok(None);
    }

    let mut data = vec![0u8; bytes as usize];
    let code = unsafe {
        RegQueryValueExW(
            key.0,
            value.as_ptr(),
            ptr::null_mut(),
            &mut kind,
            data.as_mut_ptr(),
            &mut bytes,
        )
    };

    if code != ERROR_SUCCESS {
        return Err(format!("RegQueryValueExW failed with code {code}"));
    }

    Ok(Some(text_of(&data[..(bytes as usize).min(data.len())])))
}

/// Registers `command` under `name` to run at login, replacing what the key held.
pub fn set_run_at_login(name: &str, command: &str) -> Result<(), String> {
    let key = RunKey::open()?;
    let value = wide(name);
    let data = wide(command);
    let bytes = u32::try_from(data.len() * 2)
        .map_err(|_| "the command is too long for the registry".to_owned())?;

    let code = unsafe {
        RegSetValueExW(
            key.0,
            value.as_ptr(),
            0,
            REG_SZ,
            data.as_ptr().cast::<u8>(),
            bytes,
        )
    };

    if code != ERROR_SUCCESS {
        return Err(format!("RegSetValueExW failed with code {code}"));
    }

    Ok(())
}

/// Removes the entry under `name`; removing one that is not there is not a failure.
pub fn clear_run_at_login(name: &str) -> Result<(), String> {
    let key = RunKey::open()?;
    let value = wide(name);

    let code = unsafe { RegDeleteValueW(key.0, value.as_ptr()) };

    if code != ERROR_SUCCESS && code != ERROR_FILE_NOT_FOUND {
        return Err(format!("RegDeleteValueW failed with code {code}"));
    }

    Ok(())
}

/// The per-user run key, closed when it goes out of scope.
struct RunKey(Hkey);

impl RunKey {
    /// Opens the key for reading and writing, creating it when the profile does not have one.
    fn open() -> Result<Self, String> {
        let sub_key = wide(RUN_KEY);
        let mut handle: Hkey = 0;
        let mut disposition = 0;

        let code = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                sub_key.as_ptr(),
                0,
                ptr::null(),
                0,
                KEY_QUERY_VALUE | KEY_SET_VALUE,
                ptr::null(),
                &mut handle,
                &mut disposition,
            )
        };

        if code != ERROR_SUCCESS {
            return Err(format!("RegCreateKeyExW failed with code {code}"));
        }

        Ok(Self(handle))
    }
}

impl Drop for RunKey {
    fn drop(&mut self) {
        unsafe { RegCloseKey(self.0) };
    }
}

/// A string as a NUL-terminated UTF-16 buffer, the shape the registry API takes.
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Reads a `REG_SZ` buffer back, dropping the terminator.
fn text_of(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();

    String::from_utf16_lossy(&units)
        .trim_end_matches('\0')
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_font_families_are_sorted_unique_and_horizontal() {
        let families = super::system_font_families().expect("Windows enumerates installed fonts");
        assert!(!families.is_empty());
        assert!(families
            .iter()
            .all(|name| !name.is_empty() && !name.starts_with('@')));
        assert!(families
            .windows(2)
            .all(|pair| pair[0].to_lowercase() < pair[1].to_lowercase()));
        assert_eq!(std::mem::size_of::<super::LogFont>(), 92);
    }

    fn now() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("the clock is after 1970")
            .as_secs() as i64
    }

    #[test]
    fn the_executable_name_drops_the_directory_and_the_extension() {
        assert_eq!(
            executable_name(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
            Some("chrome".to_owned())
        );
        assert_eq!(
            executable_name(r"D:\Tools\SentryNeko.exe"),
            Some("SentryNeko".to_owned())
        );
        assert_eq!(executable_name("notepad"), Some("notepad".to_owned()));
    }

    #[test]
    fn an_empty_image_path_has_no_name() {
        assert_eq!(executable_name(""), None);
        assert_eq!(executable_name(r"C:\Program Files\"), None);
    }

    #[test]
    fn the_current_process_has_an_id() {
        assert_ne!(current_process_id(), 0);
    }

    #[test]
    fn the_boot_counter_has_started() {
        assert!(milliseconds_since_boot() > 0);
    }

    #[test]
    fn the_last_input_is_reported_in_a_desktop_session() {
        // Only a session without an input desktop cannot answer; the collector then keeps
        // recording instead of guessing that the user is away.
        if let Some(idle) = milliseconds_since_last_input() {
            assert!(
                idle < 7 * 24 * 3_600_000,
                "the tick clock restarted instead of rolling over: {idle}"
            );
        }
    }

    #[test]
    fn the_local_midnight_belongs_to_the_current_day() {
        let now = now();
        let midnight = local_midnight(now).expect("the day has a start");

        assert!(
            midnight <= now,
            "midnight {midnight} is not after now {now}"
        );
        assert!(
            now - midnight < 86_400,
            "midnight {midnight} is more than a day before {now}"
        );
    }

    #[test]
    fn the_local_midnight_of_a_midnight_is_itself() {
        let midnight = local_midnight(now()).expect("the day has a start");

        assert_eq!(local_midnight(midnight), Some(midnight));
    }

    #[test]
    fn the_local_date_agrees_with_the_midnight_it_belongs_to() {
        let now = now();
        let date = local_date(now).expect("the day has a date");
        let midnight = local_midnight(now).expect("the day has a start");

        assert!((1..=12).contains(&date.month), "{date:?}");
        assert!((1..=31).contains(&date.day), "{date:?}");
        assert!(date.weekday < 7, "{date:?}");
        assert_eq!(local_midnight(midnight), Some(midnight));
        assert_eq!(
            local_date(midnight).map(|start| (start.year, start.month, start.day)),
            Some((date.year, date.month, date.day))
        );
    }

    #[test]
    fn the_local_minutes_count_the_wall_clock_from_midnight() {
        let now = now();
        let minutes = local_minutes(now).expect("the clock is readable");
        let midnight = local_midnight(now).expect("the day has a start");

        assert!(
            (0..1440).contains(&minutes),
            "{minutes} is not a time of day"
        );
        assert_eq!(
            local_minutes(midnight),
            Some(0),
            "midnight is zero minutes into the day"
        );

        // The wall clock agrees with the elapsed time on a day whose offset does not change.
        let elapsed = (now - midnight) / 60;

        assert!(
            (minutes - elapsed).abs() <= 90,
            "the wall clock reads {minutes} after {elapsed} minutes"
        );
    }

    #[test]
    fn an_instant_before_1970_has_no_epoch_form() {
        assert!(system_time_of(-1).is_none());
    }

    /// The FFI only fails at run time, so the round trip is checked on demand rather than on every
    /// `cargo test`: `cargo test a_run_value_round_trips -- --ignored`.
    #[test]
    #[ignore = "writes one value under the current user's run key and removes it again"]
    fn a_run_value_round_trips_through_the_registry() {
        let name = "SentryNeko-round-trip";
        let command = r#""C:\Program Files\SentryNeko\sentry-neko.exe" --autostart"#;

        clear_run_at_login(name).expect("clearing a value that is not there succeeds");
        assert_eq!(run_at_login(name).expect("read"), None);

        set_run_at_login(name, command).expect("written");
        assert_eq!(run_at_login(name).expect("read").as_deref(), Some(command));

        clear_run_at_login(name).expect("removed");
        assert_eq!(run_at_login(name).expect("read"), None);
    }
}
