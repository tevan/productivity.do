export function setupKeyboardShortcuts(handlers) {
  function onKeyDown(e) {
    // Don't fire when typing in inputs
    const tag = e.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) {
      // Only handle Escape in inputs
      if (e.key === 'Escape' && handlers.escape) {
        handlers.escape();
      }
      return;
    }

    // Cmd/Ctrl combos
    if (e.metaKey || e.ctrlKey) {
      if (e.key === 'k' && handlers.toggleMode) {
        e.preventDefault();
        handlers.toggleMode();
        return;
      }
      if ((e.key === 'f' || e.key === 'F') && handlers.searchEvents) {
        e.preventDefault();
        handlers.searchEvents();
        return;
      }
      if (e.shiftKey && (e.key === 'n' || e.key === 'N') && handlers.newNote) {
        e.preventDefault();
        handlers.newNote();
        return;
      }
      if (e.key === '1' && handlers.calSet1) {
        e.preventDefault();
        handlers.calSet1();
        return;
      }
      if (e.key === '2' && handlers.calSet2) {
        e.preventDefault();
        handlers.calSet2();
        return;
      }
      if (e.key === '3' && handlers.calSet3) {
        e.preventDefault();
        handlers.calSet3();
        return;
      }
      return;
    }

    switch (e.key) {
      case 't':
      case 'T':
        if (handlers.today) handlers.today();
        break;
      case 'n':
      case 'N':
      case 'c':
      case 'C':
        if (handlers.newEvent) {
          e.preventDefault();
          handlers.newEvent();
        }
        break;
      case '1':
        if (handlers.viewSlot1) handlers.viewSlot1();
        break;
      case '2':
        if (handlers.viewSlot2) handlers.viewSlot2();
        break;
      case '3':
        if (handlers.viewSlot3) handlers.viewSlot3();
        break;
      case '4':
        if (handlers.viewSlot4) handlers.viewSlot4();
        break;
      case 'd':
      case 'D':
        if (handlers.viewDay) handlers.viewDay();
        break;
      case 'x':
      case 'X':
        if (handlers.viewNextDays) handlers.viewNextDays();
        break;
      case 'w':
      case 'W':
        if (handlers.viewWeek) handlers.viewWeek();
        break;
      case 'm':
      case 'M':
        if (handlers.viewMonth) handlers.viewMonth();
        break;
      case 'f':
      case 'F':
        if (handlers.findTime) {
          e.preventDefault();
          handlers.findTime();
        }
        break;
      case 'y':
      case 'Y':
        // Synthesis layer — "today, honestly". Distinct from T (which
        // navigates the calendar grid). Y opens the synthesis overlay.
        if (handlers.todayPanel) {
          e.preventDefault();
          handlers.todayPanel();
        }
        break;
      case 'j':
      case 'J':
        if (handlers.next) handlers.next();
        break;
      case 'k':
      case 'K':
        if (handlers.prev) handlers.prev();
        break;
      case 'g':
      case 'G':
        if (handlers.gotoDate) {
          e.preventDefault();
          handlers.gotoDate();
        }
        break;
      case 'ArrowLeft':
        if (handlers.prev) handlers.prev();
        break;
      case 'ArrowRight':
        if (handlers.next) handlers.next();
        break;
      case 'Escape':
        if (handlers.escape) handlers.escape();
        break;
      case '/':
        if (handlers.search) {
          e.preventDefault();
          handlers.search();
        }
        break;
      case '?':
        if (handlers.help) {
          e.preventDefault();
          handlers.help();
        }
        break;
    }
  }

  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}
