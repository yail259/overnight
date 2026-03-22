/**
 * UI entry point — re-exports renderApp and types.
 */

import React from "react";
import { render } from "ink";
import App from "./app.js";
import type { AppProps } from "./app.js";
import type { OvernightConfig, ProjectInfo, AmbitionLevel } from "../types.js";
import type { Message, MessageContext } from "./types.js";

export type { Message, MessageContext };
export { type AppProps } from "./app.js";

/** Launch the Ink TUI */
export function renderApp(
  config: OvernightConfig,
  onMessage: AppProps["onMessage"],
  onAbort: AppProps["onAbort"],
  welcomeMessages: Message[],
  opts?: {
    projectList?: ProjectInfo[];
    onProjectsSelected?: (projects: string[]) => void;
    initialAmbition?: AmbitionLevel;
    onClear?: () => void;
    onCompact?: () => Promise<void>;
  },
) {
  render(
    <App
      config={config}
      onMessage={onMessage}
      onAbort={onAbort}
      onClear={opts?.onClear}
      onCompact={opts?.onCompact}
      welcomeMessages={welcomeMessages}
      projectList={opts?.projectList}
      onProjectsSelected={opts?.onProjectsSelected}
      initialAmbition={opts?.initialAmbition}
    />,
    { patchConsole: false, exitOnCtrlC: false },
  );
}
