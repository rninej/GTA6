PALMA CITY - browser version
============================

Nothing to install. No .exe, no installer, no administrator rights, no server
and no antivirus exclusion: the game is one web page that runs in the Edge or
Chrome you already have.

HOW TO PLAY
-----------
1. Extract this whole folder somewhere first (for example Desktop\Palma City).
   Do not play from inside the .zip - it must be a real folder on the disk.

2. Double-click  index.html

   That is the whole installation. Your browser opens and the game starts.

   Everything the game needs (the city textures included) is built into
   assets\app.js, so the page loads nothing from the network and needs no
   local server.

3. If your browser refuses to run a local page (some managed or very locked-down
   setups do), use the optional fallback instead: double-click  start.bat
   It serves the same files from http://127.0.0.1 and opens the game there.
   Keep its black window open while you play, and close it when you are done.

If Windows shows a "Windows protected your PC" box the first time:
click "More info", then "Run anyway". That is only because the file came from
the internet; nothing is installed and nothing is written outside this folder.

If you would rather avoid that prompt: before extracting, right-click the
downloaded .zip, choose Properties, tick "Unblock", then click OK.

WHAT IS IN THIS FOLDER
----------------------
  index.html      the game page - double-click this
  assets\app.js   the whole game, including its textures
  start.bat       optional fallback: serves the folder over http://127.0.0.1
  server.ps1      the small server start.bat runs (Windows PowerShell)
  README.txt      this file

The game never uploads anything and needs no account or internet connection.
Saves are kept by the browser for this page.

CONTROLS
--------
  W A S D .......... walk / drive
  Mouse ............ look around (click the game once to capture the pointer)
  Shift ............ sprint
  Space ............ jump (handbrake in a car)
  Left mouse ....... fire
  Right mouse ...... aim
  R ................ reload
  F ................ enter / exit a vehicle
  1 - 4 / wheel .... change weapon
  H ................ radio station (horn while driving)
  M ................ map
  Esc .............. pause / menu

TROUBLESHOOTING
---------------
- Page is blank or the browser shows a download prompt: use start.bat instead.

- start.bat window closes immediately: open PowerShell in this folder and run
      powershell -NoProfile -ExecutionPolicy Bypass -File .\server.ps1
  so the error stays on screen.

- Game is slow: close other tabs and apps, and use Edge or Chrome (not an old
  browser). The game is 3D and wants a reasonably modern graphics chip.

- "Not found": make sure you extracted the whole folder, including the assets
  folder, not just index.html.
