import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState } from 'react';
import { TextField, type TextFieldProps } from './TextField';

/** A password input with a button that shows or hides what was typed. */
export const PasswordField = forwardRef<HTMLInputElement, Omit<TextFieldProps, 'type' | 'suffix'>>(
  function PasswordField(props, ref) {
    const [visible, setVisible] = useState(false);
    const Icon = visible ? EyeOff : Eye;

    return (
      <TextField
        ref={ref}
        {...props}
        type={visible ? 'text' : 'password'}
        spellCheck={false}
        autoCapitalize="none"
        suffix={
          <button
            type="button"
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
            className="-mr-2 inline-flex size-9 cursor-pointer items-center justify-center rounded-sm text-text-secondary hover:bg-subtle hover:text-text"
          >
            <Icon aria-hidden="true" strokeWidth={1.5} className="size-[18px]" />
          </button>
        }
      />
    );
  },
);
