import type { ReactNode } from "react";
export function Field({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
  children,
  ...props
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
  children?: ReactNode;
  min?: string | number;
  max?: string | number;
  step?: string;
  placeholder?: string;
  maxLength?: number;
  minLength?: number;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required && <b> *</b>}
      </span>
      {children ? (
        <select name={name} defaultValue={defaultValue} required={required}>
          {children}
        </select>
      ) : type === "textarea" ? (
        <textarea
          name={name}
          defaultValue={defaultValue}
          required={required}
          maxLength={props.maxLength ?? 10000}
          minLength={props.minLength}
        />
      ) : (
        <input
          name={name}
          type={type}
          defaultValue={defaultValue}
          required={required}
          {...props}
        />
      )}
    </label>
  );
}
export function values(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(
    [...new FormData(form).entries()].map(([key, value]) => [
      key,
      String(value),
    ]),
  );
}
