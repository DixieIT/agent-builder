"use client";

import { useRef, useState, useTransition } from "react";
import { CheckCircle2, CircleX, FolderOpen, FolderUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteProjectAction, importIntoProjectAction } from "@/app/projects/actions";
import { IconButton } from "@/components/agents/editor/fields";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ImportReport } from "@/core/library/import-service";
import { readPickedFolder, type PickedFolder } from "@/lib/picked-folder";

/** Icon actions for the project card header. Delete is withheld for the default project. */
export function ProjectActions({ projectId, canDelete }: { projectId: string; canDelete: boolean }) {
  return (
    <div className="ml-auto flex items-center gap-1">
      <ImportFolderButton projectId={projectId} />
      {canDelete ? <DeleteProjectButton projectId={projectId} /> : null}
    </div>
  );
}

function ImportFolderButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedFolder | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, startTransition] = useTransition();
  const folderInput = useRef<HTMLInputElement>(null);

  async function pickFolder(list: FileList | null) {
    setReport(null);
    if (!list?.length) return;
    setPicked(await readPickedFolder(list));
  }

  function importFolder() {
    if (!picked) return;
    startTransition(async () => {
      const result = await importIntoProjectAction(projectId, picked.name, picked.files);
      if ("ok" in result) {
        toast.error(result.message);
        return;
      }
      setReport(result);
      if (result.failed === 0) toast.success(`Imported ${result.imported} ${result.imported === 1 ? "item" : "items"}`);
      else toast.error(`${result.failed} of ${result.lines.length} items failed`, { description: "See the list in the dialog." });
    });
  }

  return (
    <>
      <IconButton label="Import folder" onClick={() => setOpen(true)}>
        <FolderUp />
      </IconButton>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setPicked(null);
            setReport(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import folder</DialogTitle>
          </DialogHeader>
          <input
            ref={folderInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => pickFolder(e.target.files)}
            {...{ webkitdirectory: "", directory: "" }}
          />
          <button
            type="button"
            onClick={() => folderInput.current?.click()}
            className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-background/50 px-6 py-8 text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
          >
            <FolderOpen className="size-6" />
            {picked ? (
              <span>
                <span className="font-mono text-foreground">{picked.name}</span> · {picked.files.length} files
                {picked.skipped ? ` (${picked.skipped} skipped)` : ""}
              </span>
            ) : (
              "Choose a folder"
            )}
          </button>
          {report ? (
            <ul className="max-h-56 divide-y overflow-auto rounded-xl border text-sm">
              {report.lines.map((line) => (
                <li
                  key={`${line.kind}-${line.name}`}
                  className="flex items-center gap-2 px-3 py-1.5"
                  title={[line.message, ...(line.warnings ?? [])].filter(Boolean).join("\n")}
                >
                  {line.ok ? <CheckCircle2 className="size-4 shrink-0 text-chart-2" /> : <CircleX className="size-4 shrink-0 text-destructive" />}
                  <span className="text-muted-foreground">{line.kind}</span>
                  <span className="truncate font-mono">{line.name}</span>
                  {line.replaced ? <span className="ml-auto text-xs text-muted-foreground">replaced</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          <DialogFooter>
            <Button className="rounded-full" disabled={pending || !picked?.files.length} onClick={importFolder}>
              {pending ? "Importing…" : "Import folder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DeleteProjectButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      // On success the action redirects to the default project; it only returns on failure.
      const result = await deleteProjectAction(projectId);
      if (result) toast.error(result.message);
    });
  }

  return (
    <>
      <IconButton label="Delete project" onClick={() => setOpen(true)}>
        <Trash2 />
      </IconButton>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>Removes the project and its agents.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={pending} onClick={remove}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
