# Jidda's Calculator

A polished scientific calculator made with **vanilla HTML, CSS, and JavaScript**. No frameworks, package installation, external libraries, ads, analytics, or tracking.

## Files
- `index.html` — semantic UI and calculator controls
- `style.css` — responsive layout, dark/light themes, accessible focus states
- `script.js` — safe recursive-descent parser, calculator behavior, settings, memory and history

## Run locally
Keep the three files in the same folder and open `index.html` in a modern browser. Clipboard, sharing, and vibration features depend on browser/device permissions and may require HTTPS or localhost.

## Features
- Standard and scientific modes
- `+ − × ÷`, remainder, parentheses, implicit multiplication, powers, factorial, percentages, π and e
- `sin`, `cos`, `tan`, inverse trig, `sqrt`, `log`, `ln`, `abs`, `exp`
- Degree/radian toggle
- Live result preview, ANS, memory (MC/MR/M+/M−), undo, history with reuse/delete/clear
- Dark/light theme, saved preferences, precision, thousands separators
- Keyboard entry, Enter to calculate, Backspace to delete, Escape to clear, S to switch mode
- Copy result, share, optional sound/haptic feedback
- Responsive design, reduced-motion support, screen-reader status messages
- Local-only browser storage

## Test
Open `index.html?test=1` and inspect the browser developer console for the built-in math smoke tests. For a fuller test workflow, serve the directory locally and test edge cases such as division by zero, invalid factorials, huge powers, and invalid function domains.

## Notes
- This package intentionally stays with three source files as requested.
- Browser local storage is used for history and preferences; clearing site data removes them.
- This version does not include a service worker or installable PWA manifest, because those require additional files beyond HTML/CSS/JS. You can add them later if offline installation is a requirement.
