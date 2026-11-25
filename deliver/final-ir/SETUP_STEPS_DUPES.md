# Duplicate IR files: paste 1 file

In the inspection Apps Script project (not the tracker one):
1. Paste `1-inspection-project/IrFiles.gs` over IrFiles.gs (only this file changes).
2. Deploy > Manage deployments > pencil > New version (same URL).

Prevention: before an upload link is made, the script now searches the whole IR folder for the file
(same name and size anywhere in Open / Unsorted, or same name already in Closed) and skips it ("already there").
Before, only the folder of the chosen day was checked, so a different day, a different discipline or sorting, or a file
already closed was uploaded again.

Clean up: Admin > IR files > "Duplicate files" > Find duplicates. Nothing changes until you tick files and tap twice.
Ticked files go to the Drive bin (30 days). Exact copies come ticked; Open copies of already Closed files come unticked.
