# Duplicate IR files: paste 1 file

In the inspection Apps Script project (not the tracker one):
1. Paste `1-inspection-project/IrFiles.gs` over IrFiles.gs (only this file changes).
2. Deploy > Manage deployments > pencil > New version (same URL).

Prevention: the script keeps a log in a new sheet tab `_IR_Index` (name, size, Drive id, open/closed), written on every upload and close.
Before upload links are made it reads that tab once and skips a file that is already there (same file name, any size, anywhere in the IR folder).
A log row counts only if its file is still on Drive and not in the bin. Until the log exists, the old Drive search is used.
**First time: press Find duplicates once. It also builds the log.** Files put on Drive by hand are not in the log until the next Find duplicates.
Before, only the folder of the chosen day was checked, so a different day, a different discipline or sorting, or a file
already closed was uploaded again.

Clean up: Admin > IR files > "Duplicate files" > Find duplicates. Nothing changes until you tick files and tap twice.
Ticked files go to the Drive bin (30 days). Exact copies come ticked; Open copies of already Closed files come unticked.

## Auto clean on close (2 files)
Paste `1-inspection-project/IrFiles.gs` AND `1-inspection-project/Api.gs` (Api only gets the Undo hook), then New version.
When a request is closed, its IR files still in Open (same company, CIR/MIR, number; a name with a higher Rev stays) go to the Drive bin by themselves,
also when the Drive tick is off. Undo within 6 hours of the close brings them back. A file owned by another account cannot be binned by the script; it is named in the log tab.
Closes done outside the app (directly in the sheet) are not seen by this.
