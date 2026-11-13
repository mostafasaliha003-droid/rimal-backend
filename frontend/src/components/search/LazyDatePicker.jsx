import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

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
        }
        inputRef.current = node;
    }, []);

    useEffect(() => {
        activeRef.current = true;
        return () => {
            activeRef.current = false;
            cancelAnimationFrame(frameRef.current);
        };
    }, []);

    const activate = Component => {
        if (!activeRef.current || composingRef.current) return;
        const input = inputRef.current;
        const focused = input && document.activeElement === input;
        // Download completion must not replace the DOM input during typing or
        // an IME composition. Explicit calendar activation or blur can upgrade it.
        if (focused && editingRef.current) return;
        if (focused) {
            focusRef.current = {
                start: input.selectionStart,
                end: input.selectionEnd,
                direction: input.selectionDirection,
                open: openRef.current,
                arrow: arrowRef.current
            };
        }
        setCalendar(() => Component);
    };

    const enhance = () => {
        if (readyRef.current) {
            activate(readyRef.current);
            return;
        }
        if (Calendar || requestRef.current) return;
        requestRef.current = loadCalendar().then(Component => {
            readyRef.current = Component;
            activate(Component);
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
        input.focus({ preventScroll: true });
        picker.setOpen(selection.open, true);
        if (selection.start !== null && selection.end !== null) {
            input.setSelectionRange(selection.start, selection.end, selection.direction || 'none');
        }
        if (selection.open && selection.arrow) {
            const key = selection.arrow;
            arrowRef.current = null;
            frameRef.current = requestAnimationFrame(() => {
                if (document.activeElement === input) {
                    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
                }
            });
        }
    }, [Calendar]);

    if (Calendar) return <Calendar ref={pickerRef} {...props} onKeyDown={event => {
        props.onKeyDown?.(event);
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
                    // Cancel an upgrade queued immediately before this input
                    // event. The loaded component remains ready for activation.
                    setCalendar(null);
                    props.onChangeRaw?.(event);
                }}
                onCompositionStart={() => { composingRef.current = true; setCalendar(null); }}
                onCompositionEnd={() => { composingRef.current = false; }}
                onFocus={() => { openRef.current = true; editingRef.current = false; enhance(); }}
                onClick={() => { openRef.current = true; editingRef.current = false; enhance(); }}
                onBlur={() => {
                    openRef.current = false;
                    arrowRef.current = null;
                    editingRef.current = false;
                    if (readyRef.current) activate(readyRef.current);
                }}
                onKeyDown={event => {
                    props.onKeyDown?.(event);
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        openRef.current = false;
                        arrowRef.current = null;
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
