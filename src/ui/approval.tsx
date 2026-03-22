/**
 * ApprovalBar — two-button mode selection for running overnight predictions.
 * "Stick to plan" (one sprint) vs "Don't stop" (continuous sprints).
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { PendingApproval, RunMode } from "../types.js";
import { TEXT, SEMANTIC, CHROME } from "./theme.js";

export function ApprovalBar({
  approval,
  onApprove,
  onCancel,
}: {
  approval: PendingApproval;
  onApprove: (mode: RunMode) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<0 | 1>(0);

  useInput((_input, key) => {
    if (key.leftArrow || key.rightArrow || key.tab) {
      setSelected((s) => (s === 0 ? 1 : 0) as 0 | 1);
    }
    if (key.return) {
      onApprove(selected === 0 ? "stick-to-plan" : "dont-stop");
    }
    if (key.escape) onCancel();
  });

  const goalCount = approval.goals.length;

  return (
    <Box flexShrink={0} flexDirection="column" marginLeft={2} marginTop={1}>
      {/* Separator */}
      <Box marginRight={2}>
        <Text color={TEXT.muted} dimColor>{CHROME.separator.repeat(60)}</Text>
      </Box>

      {/* Prompt */}
      <Box gap={1}>
        <Text color={SEMANTIC.warning} bold>{"⚡"}</Text>
        <Text color={TEXT.primary} bold>{`${goalCount} goals`}</Text>
      </Box>

      {/* Two-button mode selection */}
      <Box gap={2} marginLeft={3} marginTop={0}>
        {/* Stick to plan */}
        <Box>
          <Text
            color={selected === 0 ? SEMANTIC.success : TEXT.muted}
            bold={selected === 0}
          >
            {selected === 0 ? CHROME.radioOn : CHROME.radioOff}
            {" Stick to plan"}
          </Text>
        </Box>

        {/* Don't stop */}
        <Box>
          <Text
            color={selected === 1 ? SEMANTIC.danger : TEXT.muted}
            bold={selected === 1}
          >
            {selected === 1 ? CHROME.radioOn : CHROME.radioOff}
            {" Don't stop"}
          </Text>
        </Box>

        <Text color={TEXT.muted}>{CHROME.dot}</Text>
        <Text color={TEXT.muted}>{"↵ Go"}</Text>
        <Text color={TEXT.muted}>{CHROME.dot}</Text>
        <Text color={TEXT.muted}>{"Esc Cancel"}</Text>
      </Box>
    </Box>
  );
}
