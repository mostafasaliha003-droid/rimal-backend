import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

let calendarComponent;
let calendarRequest;

function loadCalendar() {
    if (!calendarRequest) {
        calendarRequest = import('./CalendarDatePicker').then(module => {
            calendarComponent = module.default;
            return calendarComponent;
        }, error => {
            calendarRequest = null;
            throw error;
        });
    }
    return calendarRequest;
}

export default function LazyDatePicker(props) {
    const [Calendar, setCalendar] = useState(() => calendarComponent);
    const inputRef = useRef(null);
    const pickerRef = useRef(null);
    const activeRef = useRef(true);
    const requestRef = useRef(null);
    const readyRef = useRef(null);
    const editingRef = useRef(false);
    const composingRef = useRef(false);
    const focusRef = useRef(null);
    const openRef = useRef(false);
    const arrowRef = useRef(null);
    const frameRef = useRef(null);
    const cancelCalendarIntent = useCallback(() => {
        openRef.current = false;
        arrowRef.current = null;
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
    }, []);
    const composingKey = event => composingRef.current || event.isComposing || event.nativeEvent?.isComposing
        || event.keyCode === 229 || event.nativeEvent?.keyCode === 229;
    const replayArrow = useCallback((picker, key) => {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            if (activeRef.current && openRef.current && pickerRef.current === picker
                && document.activeElement === picker.input && picker.isCalendarOpen()) {
                arrowRef.current = null;
                picker.input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
            }
        });
    }, []);
    const setInputRef = useCallback(node => {
        const input = inputRef.current;
        if (!node && input && document.activeElement === input) {
            // Capture at the actual DOM replacement, rather than when the
            // asynchronous import resolved, so intervening caret moves survive.
            focusRef.current = {
                start: input.selectionStart,
                end: input.selectionEnd,
                direction: input.selectionDirection,
                open: openRef.current,
                arrow: arrowRef.current
            };
        } else if (!node) {
            focusRef.current = null;
        }
        inputRef.current = node;
    }, []);

    useEffect(() => {
        activeRef.current = true;
        return () => {
            activeRef.current = false;
            cancelCalendarIntent();
        };
    }, [cancelCalendarIntent]);

    const activate = Component => {
        if (!activeRef.current || composingRef.current || !openRef.current) return;
        const input = inputRef.current;
        const focused = input && document.activeElement === input;
        // Download completion must not replace the DOM input during typing or
        // an IME composition. Only explicit calendar intent upgrades a warm field.
        if (focused && editingRef.current) return;
        if (focused) {
            focusRef.current = {
                start: input.selectionStart,
                end: input.selectionEnd,
                direction: input.selectionDirection,
                open: openRef.current,
                arrow: arrowRef.current
            };
        } else {
            focusRef.current = null;
        }
        // Tab can blur one date input and focus the next in the same event.
        // Mount the optional calendars in a background render so keyboard focus
        // and the editable field can paint before the calendar grid is built.
        startTransition(() => setCalendar(() => Component));
    };

    const enhance = (activateNow = true) => {
        if (readyRef.current) {
            if (activateNow) activate(readyRef.current);
            return;
        }
        if (Calendar || requestRef.current) return;
        requestRef.current = loadCalendar().then(Component => {
            readyRef.current = Component;
            if (openRef.current) activate(Component);
        }).catch(() => {
            // A failed optional download leaves the editable date input usable.
            // A later focus/click retries the calendar without losing its value.
            requestRef.current = null;
        });
    };

    useLayoutEffect(() => {
        const input = inputRef.current;
        if (!input || input.value === props.value) return;
        const { selectionStart, selectionEnd, selectionDirection } = input;
        input.value = props.value || '';
        if (document.activeElement === input && selectionStart !== null && selectionEnd !== null) {
            input.setSelectionRange(selectionStart, selectionEnd, selectionDirection || 'none');
        }
    }, [props.value]);

    useLayoutEffect(() => {
        if (!Calendar || !focusRef.current) return;
        const selection = focusRef.current;
        focusRef.current = null;
        const picker = pickerRef.current;
        const input = picker?.input;
        if (!input) return;
        openRef.current = selection.open;
        input.focus({ preventScroll: true });
        picker.setOpen(selection.open, true);
        if (selection.start !== null && selection.end !== null) {
            input.setSelectionRange(selection.start, selection.end, selection.direction || 'none');
        }
        if (selection.open && selection.arrow) {
            replayArrow(picker, selection.arrow);
        }
    }, [Calendar, replayArrow]);

    if (Calendar) return <Calendar ref={pickerRef} {...props}
        customInput={<input type="text"
            onBlurCapture={cancelCalendarIntent}
            onCompositionStart={() => { composingRef.current = true; cancelCalendarIntent(); }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDownCapture={event => {
                // Keep IME commit/navigation keys out of datepicker intent handling.
                if (composingKey(event)) { cancelCalendarIntent(); event.stopPropagation(); }
                else if (event.key === 'Escape' && (pickerRef.current?.isCalendarOpen()
                    || openRef.current || frameRef.current !== null)) {
                    // Datepicker's default input Escape blurs and later refocuses.
                    // Close without that blur so a cancelled arrow cannot lose focus.
                    event.preventDefault();
                    event.stopPropagation();
                    cancelCalendarIntent();
                    pickerRef.current?.setOpen(false, true);
                    pickerRef.current?.input?.focus({ preventScroll: true });
                    props.onKeyDown?.(event);
                }
            }} />}
        onChangeRaw={event => {
            const picker = pickerRef.current;
            if (picker && event?.target === picker.input && picker.isCalendarOpen()) {
                cancelCalendarIntent();
                picker.setOpen(false, true);
            }
            props.onChangeRaw?.(event);
        }} onKeyDown={event => {
        if (composingKey(event)) { cancelCalendarIntent(); return; }
        props.onKeyDown?.(event);
        const picker = pickerRef.current;
        if (event.key === 'Escape') cancelCalendarIntent();
        if (picker && event.target === picker.input && !picker.isCalendarOpen()
            && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
            event.preventDefault();
            openRef.current = true;
            picker.setOpen(true);
            if (event.key !== 'Enter') {
                replayArrow(picker, event.key);
            }
        }
        if (event.key === 'Escape' && event.target !== pickerRef.current?.input) {
            // The enclosing search dialog consumes Escape propagation. Preserve
            // the datepicker popper's focus return even when a day handles it.
            pickerRef.current?.sendFocusBackToInput();
        }
    }} />;

    return <div className={`react-datepicker-wrapper ${props.wrapperClassName || ''}`}>
        <div className="react-datepicker__input-container">
            <input ref={setInputRef} type="text" id={props.id} name={props.name}
                defaultValue={props.value} className={props.className} autoComplete={props.autoComplete}
                placeholder={props.placeholderText} aria-required={props.ariaRequired}
                aria-invalid={props.ariaInvalid} aria-describedby={props.ariaDescribedBy}
                onChange={event => {
                    editingRef.current = true;
                    cancelCalendarIntent();
                    // Cancel an upgrade queued immediately before this input
                    // event. The loaded component remains ready for activation.
                    setCalendar(null);
                    props.onChangeRaw?.(event);
                }}
                onCompositionStart={() => { composingRef.current = true; cancelCalendarIntent(); setCalendar(null); }}
                onCompositionEnd={() => { composingRef.current = false; }}
                onFocus={() => { cancelCalendarIntent(); editingRef.current = false; enhance(false); }}
                onClick={() => { openRef.current = true; editingRef.current = false; enhance(); }}
                onBlur={() => {
                    cancelCalendarIntent();
                    editingRef.current = false;
                }}
                onKeyDown={event => {
                    if (composingKey(event)) { cancelCalendarIntent(); event.stopPropagation(); return; }
                    props.onKeyDown?.(event);
                    if (event.key === 'Escape') {
                        if (openRef.current || frameRef.current !== null) event.preventDefault();
                        cancelCalendarIntent();
                        setCalendar(null);
                    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') {
                        event.preventDefault();
                        openRef.current = true;
                        editingRef.current = false;
                        arrowRef.current = event.key === 'Enter' ? null : event.key;
                        enhance();
                    }
                }} />
        </div>
    </div>;
}
