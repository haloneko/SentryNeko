//! Win32 FFI declarations and safe wrappers. All platform-specific code lives here.
//!
//! The calls are declared by hand instead of pulling in the `windows` crate: the collectors need
//! a handful of them, and a hand-written binding keeps the dependency list short.

use std::ffi::c_void;
use std::ptr;
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread::{self, JoinHandle, Thread};
use std::time::Duration;

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

/// `POINT`: a screen position in pixels.
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
struct Point {
    x: i32,
    y: i32,
}

/// `MSG`: one message read by a thread's message loop.
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
struct Msg {
    window: isize,
    message: u32,
    w_param: usize,
    l_param: isize,
    time: u32,
    point: Point,
}

/// `WINEVENTPROC`: the callback Windows calls on a foreground change.
type WinEventProc = unsafe extern "system" fn(isize, u32, isize, i32, i32, u32, u32);

/// `EVENT_SYSTEM_FOREGROUND`: the window in front changed.
const EVENT_SYSTEM_FOREGROUND: u32 = 0x0003;

/// `WINEVENT_OUTOFCONTEXT`: the callback runs on the thread that installed the hook, which is what
/// lets a message loop own it.
const WINEVENT_OUTOFCONTEXT: u32 = 0x0000;

/// `WM_QUIT`: ends a message loop that has no window to close.
const WM_QUIT: u32 = 0x0012;

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
    fn GetForegroundWindow() -> WindowHandle;
    fn MessageBeep(sound: u32) -> i32;
    fn IsWindowVisible(window: WindowHandle) -> i32;
    fn GetWindowTextLengthW(window: WindowHandle) -> i32;
    fn GetWindowTextW(window: WindowHandle, buffer: *mut u16, capacity: i32) -> i32;
    fn GetWindowThreadProcessId(window: WindowHandle, process_id: *mut u32) -> u32;
    fn SetWinEventHook(
        event_min: u32,
        event_max: u32,
        module: isize,
        callback: Option<WinEventProc>,
        process_id: u32,
        thread_id: u32,
        flags: u32,
    ) -> isize;
    fn UnhookWinEvent(hook: isize) -> i32;
    fn GetMessageW(message: *mut Msg, window: isize, min: u32, max: u32) -> i32;
    fn TranslateMessage(message: *const Msg) -> i32;
    fn DispatchMessageW(message: *const Msg) -> isize;
    fn PostThreadMessageW(thread_id: u32, message: u32, w_param: usize, l_param: isize) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn GetTickCount() -> u32;
    fn GetTickCount64() -> u64;
    fn GetCurrentThreadId() -> u32;
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
    })
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

/// Peak level Windows reports for a silent endpoint.
///
/// A driver's noise floor is not exactly zero, so anything at or below this is treated as silence.
const SILENCE_PEAK: f32 = 0.000_5;

/// `S_OK`, the success code COM returns.
const S_OK: i32 = 0;

/// `S_FALSE`, returned when a call succeeds without doing anything (e.g. already initialized).
const S_FALSE: i32 = 1;

/// `RPC_E_CHANGED_MODE`: the thread already joined an apartment with another model.
const RPC_E_CHANGED_MODE: i32 = 0x8001_0106u32 as i32;

/// `CLSCTX_ALL`, which lets COM pick the server's apartment.
const CLSCTX_ALL: u32 = 0x17;

/// `COINIT_MULTITHREADED`: no window message pump is involved, which suits a worker thread.
const COINIT_MULTITHREADED: u32 = 0;

/// `eRender`: the endpoint sound leaves through.
const E_RENDER: u32 = 0;

/// `eConsole`: the endpoint the user hears first.
const E_CONSOLE: u32 = 0;

/// `QUNS_BUSY`: a full-screen application is running, or presentation settings are applied.
const QUNS_BUSY: i32 = 2;

/// `QUNS_RUNNING_D3D_FULL_SCREEN`: a Direct3D application owns the screen.
const QUNS_RUNNING_D3D_FULL_SCREEN: i32 = 3;

/// `QUNS_PRESENTATION_MODE`: the machine is presenting, so nobody is typing.
const QUNS_PRESENTATION_MODE: i32 = 4;

/// `GUID`, the identifier shape COM and Core Audio exchange.
#[repr(C)]
#[derive(Clone, Copy)]
struct Guid {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

const CLSID_MM_DEVICE_ENUMERATOR: Guid = Guid {
    data1: 0xBCDE_0395,
    data2: 0xE52F,
    data3: 0x467C,
    data4: [0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E],
};

const IID_IMM_DEVICE_ENUMERATOR: Guid = Guid {
    data1: 0xA956_64D2,
    data2: 0x9614,
    data3: 0x4F35,
    data4: [0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x17, 0xE6],
};

const IID_IAUDIO_METER_INFORMATION: Guid = Guid {
    data1: 0xC022_16F6,
    data2: 0x8C67,
    data3: 0x4B5B,
    data4: [0x9D, 0x00, 0xD0, 0x08, 0xE7, 0x3E, 0x00, 0x64],
};

#[link(name = "ole32")]
extern "system" {
    fn CoInitializeEx(reserved: *mut c_void, model: u32) -> i32;
    fn CoUninitialize();
    fn CoCreateInstance(
        class: *const Guid,
        outer: *mut c_void,
        context: u32,
        interface: *const Guid,
        object: *mut *mut c_void,
    ) -> i32;
}

#[link(name = "shell32")]
extern "system" {
    fn SHQueryUserNotificationState(state: *mut i32) -> i32;
}

/// Whether media is playing: sound on the default output, or a full-screen app.
///
/// Watching a video leaves the keyboard and mouse untouched for longer than any idle timeout, so the
/// collector asks this before deciding that the chair is empty. Either signal is enough: a windowed
/// player that is heard, and a muted full-screen one that is seen.
#[must_use]
pub fn media_is_playing() -> bool {
    audio_is_playing() || full_screen_app_is_running()
}

/// Whether the default output device is producing sound.
fn audio_is_playing() -> bool {
    // Core Audio is COM; a worker thread has to join an apartment before asking. A thread already in
    // one answers `RPC_E_CHANGED_MODE`, and the objects below are still usable from it.
    let initialized = unsafe { CoInitializeEx(ptr::null_mut(), COINIT_MULTITHREADED) };
    let joined = initialized == S_OK || initialized == S_FALSE;
    let usable = joined || initialized == RPC_E_CHANGED_MODE;

    if !usable {
        return false;
    }

    let playing = unsafe { default_output_peak() }.is_some_and(is_loud);

    if joined {
        unsafe { CoUninitialize() };
    }

    playing
}

/// Peak level of the default output endpoint; `None` when it cannot be read.
///
/// The endpoint's meter is the mix of every stream played on it, so one call covers every player.
unsafe fn default_output_peak() -> Option<f32> {
    let mut enumerator: *mut c_void = ptr::null_mut();
    let created = CoCreateInstance(
        &CLSID_MM_DEVICE_ENUMERATOR,
        ptr::null_mut(),
        CLSCTX_ALL,
        &IID_IMM_DEVICE_ENUMERATOR,
        &mut enumerator,
    );

    if created != S_OK || enumerator.is_null() {
        return None;
    }

    let get_default: unsafe extern "system" fn(*mut c_void, u32, u32, *mut *mut c_void) -> i32 =
        slot(enumerator, 4);
    let mut device: *mut c_void = ptr::null_mut();
    let found = get_default(enumerator, E_RENDER, E_CONSOLE, &mut device);
    release(enumerator);

    if found != S_OK || device.is_null() {
        return None;
    }

    let activate: unsafe extern "system" fn(
        *mut c_void,
        *const Guid,
        u32,
        *mut c_void,
        *mut *mut c_void,
    ) -> i32 = slot(device, 3);
    let mut meter: *mut c_void = ptr::null_mut();
    let activated = activate(
        device,
        &IID_IAUDIO_METER_INFORMATION,
        CLSCTX_ALL,
        ptr::null_mut(),
        &mut meter,
    );
    release(device);

    if activated != S_OK || meter.is_null() {
        return None;
    }

    let get_peak: unsafe extern "system" fn(*mut c_void, *mut f32) -> i32 = slot(meter, 3);
    let mut peak = 0.0f32;
    let read = get_peak(meter, &mut peak);
    release(meter);

    (read == S_OK).then_some(peak)
}

/// The function at `index` of `object`'s COM vtable.
///
/// Every interface begins with the same three `IUnknown` entries (`QueryInterface`, `AddRef`,
/// `Release`), so an index is the method's position in its interface declaration.
unsafe fn slot<T>(object: *mut c_void, index: usize) -> T {
    let vtable = *(object as *mut *const *const c_void);

    std::mem::transmute_copy(&*vtable.add(index))
}

/// Drops one COM reference, ignoring an object that was never created.
unsafe fn release(object: *mut c_void) {
    if object.is_null() {
        return;
    }

    let drop_reference: unsafe extern "system" fn(*mut c_void) -> u32 = slot(object, 2);
    drop_reference(object);
}

/// Whether a peak level is sound rather than a driver's noise floor.
fn is_loud(peak: f32) -> bool {
    peak.is_finite() && peak > SILENCE_PEAK
}

/// Whether a full-screen app is running: a muted video, a game, a presentation.
fn full_screen_app_is_running() -> bool {
    let mut state = 0i32;

    if unsafe { SHQueryUserNotificationState(&mut state) } != S_OK {
        return false;
    }

    matches!(
        state,
        QUNS_BUSY | QUNS_RUNNING_D3D_FULL_SCREEN | QUNS_PRESENTATION_MODE
    )
}

/// A thread Windows wakes whenever the window in front changes.
///
/// The sampling loop keeps its own clock — durations and the idle check still need one — but a
/// switch no longer waits for the next tick: the hook unparks the loop, which reads the window in
/// front at once.
pub struct ForegroundWatch {
    thread_id: u32,
    thread: Option<JoinHandle<()>>,
}

impl ForegroundWatch {
    /// Installs the hook on a thread of its own, which runs the message loop Windows requires.
    ///
    /// Returns `None` when the hook cannot be installed; the caller then falls back to sampling on
    /// its clock, which is slower but still correct.
    pub fn install() -> Option<Self> {
        let (sender, receiver) = mpsc::channel();
        let thread = thread::Builder::new()
            .name("foreground-watch".to_owned())
            .spawn(move || unsafe {
                let hook = SetWinEventHook(
                    EVENT_SYSTEM_FOREGROUND,
                    EVENT_SYSTEM_FOREGROUND,
                    0,
                    Some(on_foreground_change),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT,
                );

                // The caller needs the id before it can ask this loop to quit.
                let _ = sender.send(GetCurrentThreadId());

                if hook == 0 {
                    return;
                }

                let mut message = Msg::default();
                while GetMessageW(&mut message, 0, 0, 0) > 0 {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }

                UnhookWinEvent(hook);
            })
            .ok()?;

        let thread_id = receiver.recv_timeout(Duration::from_secs(1)).ok()?;

        Some(Self {
            thread_id,
            thread: Some(thread),
        })
    }

    /// Ends the message loop and waits for the hook thread.
    pub fn stop(&mut self) {
        let Some(thread) = self.thread.take() else {
            return;
        };

        unsafe {
            PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0);
        }

        let _ = thread.join();
    }
}

impl Drop for ForegroundWatch {
    fn drop(&mut self) {
        self.stop();
    }
}

/// The sampling thread a foreground change should wake.
static WAKER: Mutex<Option<Thread>> = Mutex::new(None);

/// Makes `target` the thread that a foreground change wakes.
pub fn wake_on_foreground_change(target: Thread) {
    if let Ok(mut waker) = WAKER.lock() {
        *waker = Some(target);
    }
}

/// Stops waking the sampling thread, which is leaving its loop.
pub fn forget_foreground_waker() {
    if let Ok(mut waker) = WAKER.lock() {
        *waker = None;
    }
}

/// Runs on the hook thread: hands the wake-up to the sampler without waiting for it.
unsafe extern "system" fn on_foreground_change(
    _hook: isize,
    _event: u32,
    _window: isize,
    _object: i32,
    _child: i32,
    _thread: u32,
    _time: u32,
) {
    // A sampler that is busy holding the lock is already awake; skipping the wake-up is enough.
    if let Ok(waker) = WAKER.try_lock() {
        if let Some(target) = waker.as_ref() {
            target.unpark();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn the_boot_counter_has_started() {
        assert!(milliseconds_since_boot() > 0);
    }

    #[test]
    fn only_a_level_above_the_noise_floor_counts_as_sound() {
        assert!(!is_loud(0.0));
        assert!(!is_loud(SILENCE_PEAK), "the driver's floor is not sound");
        assert!(!is_loud(f32::NAN), "an unreadable level is not sound");
        assert!(is_loud(0.25));
    }

    #[test]
    fn the_media_check_answers_without_crashing() {
        // What is playing depends on the machine, so only the round trip through COM is asserted:
        // every pointer released, no call through a wrong vtable index.
        let _ = media_is_playing();
    }

    #[test]
    fn the_foreground_hook_starts_and_stops() {
        // A session without a desktop cannot install the hook; the collector then falls back to
        // its clock, so `None` is a valid answer.
        if let Some(mut watch) = ForegroundWatch::install() {
            watch.stop();
        }
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
