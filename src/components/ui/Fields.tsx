import type { ChangeEventHandler, ReactNode } from "react";
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
  value?: string;
  onChange?: ChangeEventHandler<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required && <b> *</b>}
      </span>
      {children ? (
        <select
          name={name}
          defaultValue={defaultValue}
          required={required}
          value={props.value}
          onChange={props.onChange}
        >
          {children}
        </select>
      ) : type === "textarea" ? (
        <textarea
          name={name}
          defaultValue={defaultValue}
          required={required}
          maxLength={props.maxLength ?? 10000}
          minLength={props.minLength}
          value={props.value}
          onChange={props.onChange}
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
