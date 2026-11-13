/**
 * The bounds of the workspace reader's inputs (T014; PT-151-034;
 * contracts/workspace-reader.md §7, F151-FR-034). One constant per bound of
 * the closed set "Reader inputs", read from the generated tables — never a
 * magic number beside a read.
 */
import { closedSetReaderInputs } from "../generated/closed-sets.ts";

const bounds = closedSetReaderInputs.bounds as Record<string, number>;

/** The newest 8 MiB of an event stream (`events.jsonl`, both engines). */
export const EVENT_TAIL_BYTES: number = bounds["eventTailBytes"] ?? 8_388_608;
/** One JSON record (state, launch, lease, ledger, loop, registry, workspace). */
export const JSON_RECORD_BYTES: number = bounds["jsonRecordBytes"] ?? 262_144;
/** `tasks.md` at most. */
export const TASKS_MD_BYTES: number = bounds["tasksMdBytes"] ?? 2_097_152;
