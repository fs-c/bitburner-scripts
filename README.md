Scripts for the game [bitburner](https://github.com/bitburner-official/bitburner-src). Using a modified version of the official [bitburner-typescript](https://github.com/bitburner-official/typescript-template) template.

## Debugging

Some modifications were made to make debugging through VSCode work.

If using Steam, make sure you run the game with the `--remote-debugging-port=9222` launch option.

In VSCode, under "Run and Debug", run "Attach to BitBurner". Because source maps are generated and added inline by `tsc`, the debugger bundled with the game knows about the actual sources and can communicate meaningfully with VSCode.
