import type {
  CategorySuggestionDto,
  PatchSetDto,
  ReceiptDto,
  ReceiptOpDto,
} from "@saddlebag/contracts";
import {
  hlcFromString,
  hlcToString,
  InvariantViolationError,
  isScheduleFLineId,
  type CategorySuggestion,
  type EditableFields,
  type ReceiptOp,
  type ReceiptProps,
  type ScheduleFLineId,
  type Stamped,
} from "@saddlebag/domain";

function toScheduleFLine(value: string): ScheduleFLineId {
  if (!isScheduleFLineId(value)) {
    throw new InvariantViolationError(`unknown Schedule F line: "${value}"`);
  }
  return value;
}

function stampedToDto<T>(stamped: Stamped<T>): { value: T; at: string; rev: number } {
  return { value: stamped.value, at: hlcToString(stamped.at), rev: stamped.rev };
}

function stampedFromDto<T>(dto: { value: T; at: string; rev: number }): Stamped<T> {
  return { value: dto.value, at: hlcFromString(dto.at), rev: dto.rev };
}

export function patchSetToDto(set: Partial<EditableFields>): PatchSetDto {
  const dto: PatchSetDto = {};
  if (set.vendor !== undefined) dto.vendor = set.vendor;
  if (set.totalCents !== undefined) dto.totalCents = set.totalCents;
  if (set.purchasedAt !== undefined) dto.purchasedAt = set.purchasedAt;
  if (set.memo !== undefined) dto.memo = set.memo;
  if (set.category !== undefined) dto.category = set.category;
  return dto;
}

export function patchSetFromDto(dto: PatchSetDto): Partial<EditableFields> {
  const set: Partial<EditableFields> = {};
  if (dto.vendor !== undefined) set.vendor = dto.vendor;
  if (dto.totalCents !== undefined) set.totalCents = dto.totalCents;
  if (dto.purchasedAt !== undefined) set.purchasedAt = dto.purchasedAt;
  if (dto.memo !== undefined) set.memo = dto.memo;
  if (dto.category !== undefined) {
    set.category = dto.category === null ? null : toScheduleFLine(dto.category);
  }
  return set;
}

export function opToDto(op: ReceiptOp): ReceiptOpDto {
  switch (op.kind) {
    case "capture":
      return {
        kind: "capture",
        opId: op.opId,
        receiptId: op.receiptId,
        deviceId: op.deviceId,
        capturedAt: op.capturedAt,
        at: hlcToString(op.at),
        imageRef: op.imageRef,
        initial: patchSetToDto(op.initial),
      };
    case "patch":
      return {
        kind: "patch",
        opId: op.opId,
        receiptId: op.receiptId,
        deviceId: op.deviceId,
        baseRev: op.baseRev,
        at: hlcToString(op.at),
        set: patchSetToDto(op.set),
      };
    case "approve":
      return {
        kind: "approve",
        opId: op.opId,
        receiptId: op.receiptId,
        deviceId: op.deviceId,
        baseRev: op.baseRev,
        at: hlcToString(op.at),
        category: op.category,
      };
  }
}

export function opFromDto(dto: ReceiptOpDto): ReceiptOp {
  switch (dto.kind) {
    case "capture":
      return {
        kind: "capture",
        opId: dto.opId,
        receiptId: dto.receiptId,
        deviceId: dto.deviceId,
        capturedAt: dto.capturedAt,
        at: hlcFromString(dto.at),
        imageRef: dto.imageRef,
        initial: patchSetFromDto(dto.initial),
      };
    case "patch":
      return {
        kind: "patch",
        opId: dto.opId,
        receiptId: dto.receiptId,
        deviceId: dto.deviceId,
        baseRev: dto.baseRev,
        at: hlcFromString(dto.at),
        set: patchSetFromDto(dto.set),
      };
    case "approve":
      return {
        kind: "approve",
        opId: dto.opId,
        receiptId: dto.receiptId,
        deviceId: dto.deviceId,
        baseRev: dto.baseRev,
        at: hlcFromString(dto.at),
        category: toScheduleFLine(dto.category),
      };
  }
}

function suggestionToDto(suggestion: CategorySuggestion): CategorySuggestionDto {
  return { ...suggestion, extracted: { ...suggestion.extracted } };
}

function suggestionFromDto(dto: CategorySuggestionDto): CategorySuggestion {
  return {
    line: toScheduleFLine(dto.line),
    confidence: dto.confidence,
    rationale: dto.rationale,
    source: dto.source,
    extracted: { ...dto.extracted },
  };
}

export function receiptToDto(props: ReceiptProps): ReceiptDto {
  return {
    id: props.id,
    capturedAt: props.capturedAt,
    capturedBy: props.capturedBy,
    imageRef: props.imageRef,
    rev: props.rev,
    fields: {
      vendor: stampedToDto(props.fields.vendor),
      totalCents: stampedToDto(props.fields.totalCents),
      purchasedAt: stampedToDto(props.fields.purchasedAt),
      memo: stampedToDto(props.fields.memo),
      category: stampedToDto(props.fields.category),
    },
    suggestion: props.suggestion === null ? null : suggestionToDto(props.suggestion),
    approved: stampedToDto(props.approved),
    conflictLog: props.conflictLog.map((conflict) => ({ ...conflict })),
  };
}

export function receiptFromDto(dto: ReceiptDto): ReceiptProps {
  const category = stampedFromDto(dto.fields.category);
  return {
    id: dto.id,
    capturedAt: dto.capturedAt,
    capturedBy: dto.capturedBy,
    imageRef: dto.imageRef,
    rev: dto.rev,
    fields: {
      vendor: stampedFromDto(dto.fields.vendor),
      totalCents: stampedFromDto(dto.fields.totalCents),
      purchasedAt: stampedFromDto(dto.fields.purchasedAt),
      memo: stampedFromDto(dto.fields.memo),
      category: {
        ...category,
        value: category.value === null ? null : toScheduleFLine(category.value),
      },
    },
    suggestion: dto.suggestion === null ? null : suggestionFromDto(dto.suggestion),
    approved: stampedFromDto(dto.approved),
    conflictLog: dto.conflictLog.map((conflict) => ({ ...conflict })),
  };
}
