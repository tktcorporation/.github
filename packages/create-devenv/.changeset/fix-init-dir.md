---
"@tktco/create-devenv": patch
---

fix: ignore "init" argument as directory name

When running `npx create-devenv init`, the "init" was interpreted as the target directory.
Now "init" is ignored and files are extracted to the current directory.
