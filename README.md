<p align="center">
  <img src="docs/banner.svg" alt="PLAY" width="100%">
</p>

<h3 align="center">A personal YouTube player without the ads.</h3>

<p align="center">
  <a href="https://github.com/Hiroyki/play/releases/latest"><img alt="Download for Windows" src="https://img.shields.io/badge/Download-Windows_x64-ffffff?style=for-the-badge&labelColor=000000"></a>
  <img alt="Version 1.0.0" src="https://img.shields.io/badge/version-1.0.0-ffffff?style=for-the-badge&labelColor=000000">
  <img alt="Up to 4K AV1" src="https://img.shields.io/badge/up_to-4K_AV1-ffffff?style=for-the-badge&labelColor=000000">
  <img alt="No account needed" src="https://img.shields.io/badge/account-not_needed-ffffff?style=for-the-badge&labelColor=000000">
</p>

<p align="center">
  <a href="#see-it-move">See it move</a> ·
  <a href="#what-you-get">What you get</a> ·
  <a href="#install">Install</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#keyboard-shortcuts">Shortcuts</a> ·
  <a href="#build">Build</a> ·
  <a href="#questions">Questions</a>
</p>

<p align="center">
  <img src="docs/intro.webp" alt="Intro film: the PLAY logo draws itself, opens into open movies, and shows the app" width="100%">
</p>

Play opens YouTube videos in its own window and plays the media stream directly, so pre-roll and mid-roll ads are never requested. It runs on one PC and keeps your data there.

> [!IMPORTANT]
> Play is for personal use. Fetching streams directly is against the YouTube Terms of Service, so do not host it publicly.

## See it move

**The thumbnail becomes the player, and the player follows you.** Go back to browsing and the video shrinks into the corner without stopping.

<img src="docs/demo-browse.webp" alt="A thumbnail grows into the player, then shrinks into a corner player on the home page" width="100%">

**Scrub with pictures, switch quality without a stall.** Hover the seek bar for a preview of every moment. In testing, changing from 360p to 2160p caused 0 ms of rebuffering; the first version stalled for 1.8 seconds.

<img src="docs/demo-player.webp" alt="Previews appear along the seek bar, then the quality menu switches to 2160p" width="100%">

**Search from anywhere.** Press `/`, type, or paste a YouTube link.

<img src="docs/demo-search.webp" alt="The search box opens, suggests titles, and shows results" width="100%">

## What you get

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/home.jpg" alt="Home page">
      <h3>A home page built from what you watch</h3>
      <p>Five rotating highlights with silent previews, a continue-watching row, weekly rankings, nine topics, and a shelf that changes with the time of day.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/watch.jpg" alt="Watch page">
      <h3>A watch page that fits the scene</h3>
      <p>Soft light around the player follows the picture. Subtitles, chapters, speed, autoplay, resume, and live streams are included.</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <img src="docs/explore.jpg" alt="Weekly rankings and topics">
      <h3>Rankings and topics</h3>
      <p>The week's most viewed search results, sorted by view count, for the home page and for each topic.</p>
    </td>
    <td valign="top">
      <img src="docs/channel.jpg" alt="Channel page">
      <h3>Channels and playlists</h3>
      <p>Videos, live streams, and playlists of any channel. Subscriptions collect new uploads on one page.</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <img src="docs/quality.jpg" alt="Quality menu">
      <h3>Up to 4K</h3>
      <p>AV1 where the hardware decodes it efficiently, H.264 everywhere else. Automatic mode follows your connection and the player size.</p>
    </td>
    <td valign="top">
      <img src="docs/settings.jpg" alt="Settings page">
      <h3>Your data, in one file</h3>
      <p>Subscriptions, saved videos, and history stay on the PC, with a daily backup, export, import, and restore.</p>
    </td>
  </tr>
</table>

| | Play |
|---|---|
| Pre-roll and mid-roll ads | Never requested |
| Sponsor segments recorded by creators | Still play |
| YouTube account | Not used |
| Where your data lives | One JSON file on your PC |
| Native window | `Play.exe`, 60 KB |
| Installer | 36 MB, Node.js included |
| Time to install | 6.2 seconds in testing |

### Start times

Play prepares a video when the pointer rests on it. Both bars show the slowest start measured in testing, in seconds.

```mermaid
xychart-beta
  title "Seconds until the picture moves (lower is better)"
  x-axis ["Prepared by hovering", "Clicked cold"]
  y-axis "Seconds" 0 --> 14
  bar [1.6, 12.6]
```

## Install

1. Download `Play-Setup-<version>.exe` from [Releases](https://github.com/Hiroyki/play/releases/latest).
2. Check that its SHA-256 matches the one in the release notes.
3. Run it. No administrator rights are needed; Play is installed to `%LOCALAPPDATA%\Programs\Play`.

Requirements: 64-bit Windows 11, where Play is tested. Windows 10 is untested and needs the [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

If the PC has no yt-dlp, Play downloads the official release on first start and verifies its SHA-256 before using it.

> [!NOTE]
> The installer is not code-signed, so SmartScreen shows a warning.

To remove Play, use **Settings > Apps**. Your data stays in `%LOCALAPPDATA%\Play`.

<details>
<summary><b>Run from source instead</b></summary>

<br>

You need Node.js 22 or later and [yt-dlp](https://github.com/yt-dlp/yt-dlp) on `PATH`.

```powershell
npm install
npm start
```

Open `http://localhost:4321`. This copy keeps its data in `data`, separate from an installed copy. To move between the two, use Export and Import in Settings.

</details>

## How it works

```mermaid
flowchart LR
  subgraph PC["Your PC"]
    W["Play.exe<br/>WinForms + WebView2"] -->|"http://localhost"| S["Local server<br/>Node.js"]
    S --> D[("library.json")]
    S --> Y["yt-dlp"]
  end
  S -->|"search, channels, comments"| M["YouTube"]
  Y -->|"stream addresses"| M
  S -->|"media, by byte range"| G["googlevideo.com"]
```

`Play.exe` starts the server on a loopback port and stops it on exit, even after a crash. What happens when you press play:

```mermaid
sequenceDiagram
  autonumber
  participant P as Player
  participant S as Local server
  participant Y as yt-dlp
  participant G as googlevideo.com
  P->>S: Play this video
  S->>Y: Find stream addresses
  Y-->>S: Formats, captions, chapters
  Note over S: Wait until YouTube<br/>activates the addresses
  S->>G: First 4 KB of each format
  G-->>S: MP4 index
  S-->>P: DASH manifest
  loop While playing
    P->>S: Next byte range
    S->>G: Same range
    G-->>P: Media, relayed
  end
```

<details>
<summary><b>Privacy and security</b></summary>

<br>

- The server listens on `127.0.0.1` and rejects requests with a foreign `Host` or `Origin`.
- The media proxy accepts only video IDs and `googlevideo.com` addresses.
- Text from YouTube is inserted as text, never as HTML, under a content security policy.
- The app contacts YouTube and its image hosts, PyPI to check the yt-dlp version, and GitHub when it installs yt-dlp.

</details>

<details>
<summary><b>Project layout</b></summary>

<br>

| Path | Contents |
|---|---|
| `server/youtube.js` | Search, channels, playlists, comments, home page |
| `server/stream.js` | Stream lookup, DASH and HLS, media proxy, subtitles |
| `server/ytdlp.js` | Finding, installing, and updating yt-dlp |
| `server/library.js` | User data, backups, import |
| `public` | Interface; plain JavaScript and CSS with no build step |
| `windows/Play.cs` | Native window and server lifecycle |
| `windows/Setup.cs` | Installer |

</details>

<details>
<summary><b>Configuration</b></summary>

<br>

| Variable | Default | Usage |
|---|---|---|
| `PORT` | `4321` | Server port |
| `PLAY_LIBRARY` | `data/library.json` | User data file; backups go to `cadangan` beside it |
| `PLAY_BIN` | `data/bin` | Where Play stores its own yt-dlp |
| `PLAY_INSTALLED` | unset | When set, a missing yt-dlp is installed on start |
| `PLAY_YTDLP_URL` | latest yt-dlp release on GitHub | Download source for yt-dlp |
| `YTDLP` | unset | Path to a specific yt-dlp |

</details>

## Keyboard shortcuts

| Playback | | Navigation | |
|---|---|---|---|
| <kbd>Space</kbd> <kbd>K</kbd> | Play or pause | <kbd>/</kbd> | Search |
| <kbd>J</kbd> <kbd>L</kbd> | 10 seconds back or forward | <kbd>Ctrl</kbd> <kbd>K</kbd> | Search, in the app |
| <kbd>←</kbd> <kbd>→</kbd> | 5 seconds back or forward | <kbd>Alt</kbd> <kbd>←</kbd> <kbd>→</kbd> | Back or forward, in the app |
| <kbd>↑</kbd> <kbd>↓</kbd> | Volume | <kbd>Shift</kbd> <kbd>N</kbd> | Next video |
| <kbd>0</kbd> to <kbd>9</kbd> | Jump to 0% to 90% | <kbd>F</kbd> | Full screen |
| <kbd>&lt;</kbd> <kbd>&gt;</kbd> | Speed | <kbd>T</kbd> | Wide mode |
| <kbd>M</kbd> | Mute | <kbd>I</kbd> | Picture in picture |
| <kbd>C</kbd> | Subtitles | <kbd>F5</kbd> <kbd>F11</kbd> | Reload, full screen, in the app |

## Build

The build uses `csc.exe`, the C# compiler included with Windows, and the `Microsoft.Web.WebView2` SDK from the NuGet cache. It stops if a WebView2 file is not signed by Microsoft.

| Command | Output |
|---|---|
| `powershell -ExecutionPolicy Bypass -File windows\build.ps1` | `Play.exe` in the repository root |
| `powershell -ExecutionPolicy Bypass -File windows\installer.ps1` | `dist\Play-Setup-<version>.exe` |

The version comes from `package.json`. The installer script also stops if user data ends up in the package.

## Questions

<details>
<summary><b>Why does a video sometimes take several seconds to start?</b></summary>

<br>

YouTube activates some stream addresses a few seconds after issuing them, and Play waits for that moment. Resting the pointer on a video first hides most of the wait.

</details>

<details>
<summary><b>A video stopped playing. What now?</b></summary>

<br>

YouTube changes often, and yt-dlp follows. Open Settings, which shows when a newer yt-dlp exists and can update the copy Play installed.

</details>

<details>
<summary><b>What does not work?</b></summary>

<br>

- Private, members-only, and age-restricted videos, because Play does not sign in to YouTube.
- Shorts are hidden from lists, but a Shorts link opens normally.
- The interface is in Indonesian only.

</details>

<details>
<summary><b>Can I open it on my phone?</b></summary>

<br>

No. The server accepts connections only from the PC it runs on.

</details>

## Credits

Play is built on [yt-dlp](https://github.com/yt-dlp/yt-dlp), [YouTube.js](https://github.com/LuanRT/YouTube.js), [Shaka Player](https://github.com/shaka-project/shaka-player), [Express](https://expressjs.com), and [Instrument Sans](https://github.com/Instrument/instrument-sans).

The film, demos, and screenshots show open movies by the [Blender Foundation](https://studio.blender.org/films/), licensed CC BY: Big Buck Bunny, Sintel, Tears of Steel, Spring, Coffee Run, Sprite Fright, Charge, Agent 327, and Wing It!

Play is not affiliated with YouTube or Google.
