# Requests without an IR file: read from the sheet (no Drive scan)

1. Inspection project > IrFiles.gs: replace ALL of it with the new IrFiles.gs (deliver/final-ir/1-inspection-project/IrFiles.gs).
2. Deploy > Manage deployments > pencil > New version (same deployment, same URL).
3. App > Admin > IR files: the list "Open requests by company" now appears at once and says "From the upload log in the sheet".

The list reads tab `_IR_Index` (one fast sheet read). Files put on Drive by hand are not in it until Admin > IR files > Find duplicates runs once (it rebuilds the log). Removing a file from the app now removes its log row too.
