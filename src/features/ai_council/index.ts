/**
 * AI Council Feature Module
 *
 * Entry point for AI Council functionality.
 */

export { AiCouncilOrchestrator } from "./orchestrator";
export { handleCouncil, handleAsk } from "./commands";
export type { CouncilSession, CouncilTurn } from "./types";
export { loadCouncilConfig, isCouncilEnabled } from "../../council-config";
