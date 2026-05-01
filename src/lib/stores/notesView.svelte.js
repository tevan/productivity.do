// Notes-view selection state — shared between the holistic NotesView (main
// pane) and the sidebar's Notes list (when in Notes view). Both read and
// write through this tiny store so clicking a note in either place
// updates both.
//
// Why a store instead of a context: the sidebar mounts independently of
// the notes view; passing through a context would require a top-level
// wrapper that doesn't fit our current layout shape.

let selectedId = $state(null);

export function getNotesView() {
  return {
    get selectedId() { return selectedId; },
  };
}

export function selectNote(id) {
  selectedId = id;
}

export function clearNoteSelection() {
  selectedId = null;
}
