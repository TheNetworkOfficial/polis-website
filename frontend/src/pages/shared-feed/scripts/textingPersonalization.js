export const personalizationFields = [
  {
    name: "first_name",
    label: "First name",
    example: "Alex",
    fallback: "there",
  },
  {
    name: "last_name",
    label: "Last name",
    example: "Example",
    fallback: "friend",
  },
  {
    name: "full_name",
    label: "Full name",
    example: "Alex Example",
    fallback: "there",
  },
  {
    name: "city",
    label: "City",
    example: "Example City",
    fallback: "your community",
  },
  { name: "state", label: "State", example: "MT", fallback: "your state" },
];

export function availablePersonalization(policy) {
  return policy?.version === 1 && Array.isArray(policy.fields)
    ? personalizationFields.filter((field) =>
        policy.fields.includes(field.name),
      )
    : [];
}

export const hasPersonalization = (text) => /[{}]|\[\[|\]\]/.test(text);

export function personalizationError(code) {
  const messages = {
    texting_template_invalid:
      "Check your message and include “Reply STOP to opt out.”",
    texting_merge_field_unknown:
      "Choose a supported detail from Personalize, or remove the unrecognized field.",
    texting_merge_syntax_invalid:
      "Finish or remove the incomplete field. Use Personalize to insert a detail.",
    texting_personalization_unavailable:
      "Personalization is unavailable for this campaign. Remove the fields to continue.",
    texting_message_too_long:
      "A personalized message is too long. Shorten the message before continuing.",
    texting_personalization_reprepare_required:
      "These recipients were prepared before personalization was available. Create a new campaign to use merge tags.",
    texting_personalization_value_invalid:
      "A saved recipient detail cannot be used. Correct the contact and select recipients in a new campaign.",
  };
  return Object.hasOwn(messages, code) ? messages[code] : "";
}

/** Fictional previews are examples only; the server resolves each selected contact. */
export function personalizationPreview(text, policy) {
  text = String(text ?? "");
  const available = availablePersonalization(policy);
  const used = new Set();
  let error = "";
  const example = text.replace(/\{\{([^{}]*?)\}\}/g, (token, name) => {
    const field = available.find((item) => item.name === name);
    if (!field) {
      error ||= available.length
        ? "Choose a supported detail from Personalize, or remove the unrecognized field."
        : "Personalization is unavailable for this campaign. Remove the fields to continue.";
      return token;
    }
    used.add(name);
    return field.example;
  });
  if (hasPersonalization(example) && !error)
    error =
      "Finish or remove the incomplete field. Use Personalize to insert a detail.";
  return {
    example,
    error,
    personalized: hasPersonalization(text),
    fields: personalizationFields.filter((field) => used.has(field.name)),
  };
}

/** Replace the current selection without changing surrounding message text. */
export function insertPersonalization(
  text,
  name,
  start,
  end,
  policy,
  maxLength = 1600,
) {
  text = String(text ?? "");
  if (!availablePersonalization(policy).some((field) => field.name === name))
    return null;
  const from = Number.isInteger(start)
    ? Math.max(0, Math.min(start, text.length))
    : text.length;
  const to = Number.isInteger(end)
    ? Math.max(from, Math.min(end, text.length))
    : from;
  const token = `{{${name}}}`;
  const value = text.slice(0, from) + token + text.slice(to);
  if (value.length > maxLength) return null;
  return { value, caret: from + token.length };
}
