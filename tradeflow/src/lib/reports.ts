/**
 * Report templates as the application sees them.
 *
 * The stock library lives in migration 0004 as JSON on `report_templates`.
 * This module parses that JSON defensively — a template edited by a business
 * is user input by the time it reaches here — and describes the shapes the
 * form renderer and the PDF both work from.
 */

import type { Json } from './database.types';

export type ReportFieldType =
  | 'text' | 'textarea' | 'date' | 'time' | 'number'
  | 'select' | 'checkbox' | 'photos' | 'signature' | 'table';

export interface ReportField {
  id: string;
  label: string;
  type: ReportFieldType;
  options?: string[];
  required?: boolean;
  help?: string;
}

export interface ReportSection {
  id: string;
  title: string;
  fields: ReportField[];
}

const FIELD_TYPES: ReportFieldType[] = [
  'text', 'textarea', 'date', 'time', 'number',
  'select', 'checkbox', 'photos', 'signature', 'table',
];

/**
 * Parse the `sections` column into something the renderer can trust. Anything
 * malformed is dropped rather than thrown: a template with one bad field
 * should still let a person file the report.
 */
export function parseSections(value: Json | null | undefined): ReportSection[] {
  if (!Array.isArray(value)) return [];
  const sections: ReportSection[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const section = raw as Record<string, unknown>;
    const id = typeof section.id === 'string' ? section.id : null;
    const title = typeof section.title === 'string' ? section.title : null;
    if (!id || !title) continue;

    const fields: ReportField[] = [];
    if (Array.isArray(section.fields)) {
      for (const rawField of section.fields) {
        if (!rawField || typeof rawField !== 'object' || Array.isArray(rawField)) continue;
        const field = rawField as Record<string, unknown>;
        const fieldId = typeof field.id === 'string' ? field.id : null;
        const label = typeof field.label === 'string' ? field.label : null;
        const type = typeof field.type === 'string' && FIELD_TYPES.includes(field.type as ReportFieldType)
          ? (field.type as ReportFieldType)
          : 'text';
        if (!fieldId || !label) continue;

        fields.push({
          id: fieldId,
          label,
          type,
          options: Array.isArray(field.options)
            ? field.options.filter((o): o is string => typeof o === 'string')
            : undefined,
          required: field.required === true,
          help: typeof field.help === 'string' ? field.help : undefined,
        });
      }
    }

    sections.push({ id, title, fields });
  }

  return sections;
}

/** Every field across the sections, flattened. */
export function allFields(sections: ReportSection[]): ReportField[] {
  return sections.flatMap((section) => section.fields);
}

/** Does this template ask for photos? Drives whether the uploader is shown. */
export function wantsPhotos(sections: ReportSection[]): boolean {
  return allFields(sections).some((field) => field.type === 'photos');
}

export function wantsSignature(sections: ReportSection[]): boolean {
  return allFields(sections).some((field) => field.type === 'signature');
}

/**
 * Pull the answers out of a submitted form.
 *
 * Only ids the template declares are kept, so a hand-crafted POST cannot stuff
 * arbitrary JSON into the `data` column.
 */
export function readAnswers(
  sections: ReportSection[],
  formData: FormData
): Record<string, string | number | boolean> {
  const answers: Record<string, string | number | boolean> = {};

  for (const field of allFields(sections)) {
    if (field.type === 'photos' || field.type === 'signature') continue;
    const key = `field.${field.id}`;

    if (field.type === 'checkbox') {
      answers[field.id] = formData.get(key) !== null;
      continue;
    }

    const raw = formData.get(key);
    if (typeof raw !== 'string' || raw.trim() === '') continue;

    if (field.type === 'number') {
      const value = Number(raw);
      if (Number.isFinite(value)) answers[field.id] = value;
      continue;
    }

    answers[field.id] = raw.slice(0, 20_000);
  }

  return answers;
}

/** Required fields the person has not filled in. */
export function missingRequired(
  sections: ReportSection[],
  answers: Record<string, unknown>
): ReportField[] {
  return allFields(sections).filter((field) => {
    if (!field.required) return false;
    if (field.type === 'photos' || field.type === 'signature') return false;
    const value = answers[field.id];
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim() === '';
    return false;
  });
}

/**
 * A one-line summary of a filled-in report, for lists and for the AI context.
 * Uses whichever of the first few text answers has something in it.
 */
export function summarise(
  sections: ReportSection[],
  answers: Record<string, unknown>,
  maxLength = 160
): string {
  for (const field of allFields(sections)) {
    if (field.type !== 'textarea' && field.type !== 'text') continue;
    const value = answers[field.id];
    if (typeof value === 'string' && value.trim().length > 12) {
      const text = value.trim().replace(/\s+/g, ' ');
      return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
    }
  }
  return '';
}

/** The stock template keys, in the order the picker shows them. */
export const SYSTEM_TEMPLATE_KEYS = [
  'daily_site', 'progress', 'defect', 'safety', 'inspection', 'variation',
  'security_incident', 'patrol', 'maintenance', 'service', 'handover',
] as const;
