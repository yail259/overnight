/**
 * CommandDropdown — visual autocomplete for slash commands.
 * Shows matching commands with descriptions when user types "/".
 */

import React from "react";
import { Box, Text } from "ink";
import { TEXT, SEMANTIC, CHROME } from "./theme.js";

interface CommandOption {
  name: string;
  description: string;
}

interface CommandDropdownProps {
  commands: CommandOption[];
  filter: string; // current input after "/"
  activeIndex: number;
}

export function CommandDropdown({ commands, filter, activeIndex }: CommandDropdownProps) {
  if (commands.length === 0) return null;

  const filtered = filter
    ? commands.filter((c) => c.name.startsWith(filter.toLowerCase()))
    : commands;

  if (filtered.length === 0) return null;

  return (
    <Box flexDirection="column" marginLeft={4} marginBottom={0}>
      {filtered.map((cmd, i) => {
        const isActive = i === activeIndex;
        return (
          <Box key={cmd.name} gap={1}>
            <Text color={isActive ? SEMANTIC.accent : TEXT.muted} bold={isActive}>
              {isActive ? CHROME.pointer : " "}
            </Text>
            <Text color={isActive ? SEMANTIC.accent : TEXT.secondary} bold={isActive}>
              {"/" + cmd.name}
            </Text>
            <Text color={TEXT.muted}>{cmd.description}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

/** Get filtered commands for dropdown display */
export function getMatchingCommands(
  input: string,
  allCommands: CommandOption[],
): CommandOption[] {
  if (!input.startsWith("/")) return [];
  const filter = input.slice(1).toLowerCase();
  if (filter.includes(" ")) return []; // already completed, hide dropdown
  return allCommands.filter((c) => c.name.startsWith(filter));
}
