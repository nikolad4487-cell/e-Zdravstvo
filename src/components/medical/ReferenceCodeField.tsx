import { useResource } from "../../hooks/useResource";
import { searchMedicalCodes } from "../../services/medicalCodes";
import { Field } from "../ui/Fields";
import { ErrorMessage } from "../ui/Feedback";
export function ReferenceCodeField({
  list,
  name,
  label,
  required = false,
  defaultValue = "",
  allowed,
}: {
  list: string;
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: string;
  allowed?: string[];
}) {
  const resource = useResource(() => searchMedicalCodes(list), list);
  return (
    <div>
      <Field
        name={name}
        label={label}
        required={required}
        defaultValue={defaultValue}
      >
        {!required && <option value="">Nije navedeno</option>}
        {(resource.data ?? [])
          .filter((c) => !allowed || allowed.includes(c.code))
          .map((c) => (
            <option value={c.code} key={c.code}>
              ({c.code}) {c.name}
            </option>
          ))}
      </Field>
      {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
    </div>
  );
}
