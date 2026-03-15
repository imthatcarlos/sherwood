/**
 * Chat commands — sherwood chat <syndicate-name> [subcommand]
 *
 * Uses XMTP for encrypted group messaging tied to syndicates.
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getAccount } from "../lib/client.js";
import { resolveSyndicate } from "../lib/ens.js";
import {
  getXmtpClient,
  getGroup,
  addMember,
  sendEnvelope,
  sendMarkdown as xmtpSendMarkdown,
  sendReaction as xmtpSendReaction,
  streamMessages,
  getRecentMessages,
} from "../lib/xmtp.js";
import type { ChatEnvelope, MessageType } from "../lib/types.js";
import { isText, isMarkdown, isReaction } from "@xmtp/node-sdk";
import type { DecodedMessage, Reaction } from "@xmtp/node-sdk";
import { PermissionLevel } from "@xmtp/node-bindings";

// ── Formatting ──

function formatTimestamp(date: Date): string {
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function colorByType(type: MessageType): (text: string) => string {
  switch (type) {
    case "TRADE_EXECUTED":
      return chalk.green;
    case "RISK_ALERT":
      return chalk.red;
    case "TRADE_SIGNAL":
      return chalk.yellow;
    case "POSITION_UPDATE":
      return chalk.cyan;
    case "LP_REPORT":
      return chalk.magenta;
    case "AGENT_REGISTERED":
    case "MEMBER_JOIN":
      return chalk.blue;
    case "RAGEQUIT_NOTICE":
      return chalk.red;
    default:
      return chalk.white;
  }
}

function formatMessage(msg: DecodedMessage): string {
  const time = chalk.dim(`[${formatTimestamp(msg.sentAt)}]`);
  const sender = chalk.dim(truncateAddress(msg.senderInboxId));

  // Handle reactions
  if (isReaction(msg)) {
    const reaction = msg.content as Reaction;
    return `${time} ${sender} reacted ${reaction.content} to ${truncateAddress(reaction.reference)}`;
  }

  // Handle markdown
  if (isMarkdown(msg)) {
    return `${time} ${sender}\n${msg.content as string}`;
  }

  // Handle text messages (may be JSON envelope or plain text)
  if (isText(msg)) {
    const text = msg.content as string;
    try {
      const envelope: ChatEnvelope = JSON.parse(text);
      const color = colorByType(envelope.type);
      const from = envelope.from ? truncateAddress(envelope.from) : sender;

      if (envelope.type === "MESSAGE") {
        return `${time} ${chalk.dim(from)}: ${envelope.text || ""}`;
      }

      if (envelope.type === "AGENT_REGISTERED") {
        return `${time} ${color(`[${envelope.type}]`)} Agent ${truncateAddress(envelope.agent?.address || "?")} registered`;
      }

      if (envelope.type === "MEMBER_JOIN") {
        return `${time} ${color(`[${envelope.type}]`)} ${truncateAddress(envelope.from || "?")} joined`;
      }

      // Generic envelope display
      const summary = envelope.text || envelope.type;
      return `${time} ${color(`[${envelope.type}]`)} ${chalk.dim(from)}: ${summary}`;
    } catch {
      // Plain text, not JSON
      return `${time} ${sender}: ${text}`;
    }
  }

  // Fallback
  return `${time} ${sender}: ${msg.fallback || "[unsupported content]"}`;
}

// ── Command Registration ──

export function registerChatCommands(program: Command): void {
  const chat = program
    .command("chat <name>")
    .description("Stream syndicate chat messages in real-time")
    .action(async (name: string) => {
      const spinner = ora("Connecting to chat...").start();
      try {
        await resolveSyndicate(name); // verify syndicate exists
        const client = await getXmtpClient();
        const group = await getGroup(client, name);
        spinner.succeed(`Connected to ${name}.sherwoodagent.eth`);
        console.log(chalk.dim("Streaming messages... (Ctrl+C to exit)\n"));

        const cleanup = await streamMessages(group, (msg) => {
          console.log(formatMessage(msg));
        });

        // Handle graceful shutdown
        process.on("SIGINT", async () => {
          console.log(chalk.dim("\nDisconnecting..."));
          await cleanup();
          process.exit(0);
        });

        // Keep process alive
        await new Promise(() => {});
      } catch (err) {
        spinner.fail("Failed to connect to chat");
        console.error(
          chalk.red(err instanceof Error ? err.message : String(err)),
        );
        process.exit(1);
      }
    });

  chat
    .command("send <message>")
    .description("Send a message to the syndicate chat")
    .option("--markdown", "Send as rich markdown", false)
    .action(async (message: string, opts: { markdown: boolean }) => {
      const name = chat.parent?.args[0] as string;
      const spinner = ora("Sending...").start();
      try {
        const client = await getXmtpClient();
        const group = await getGroup(client, name);

        if (opts.markdown) {
          await xmtpSendMarkdown(group, message);
        } else {
          const envelope: ChatEnvelope = {
            type: "MESSAGE",
            from: getAccount().address,
            text: message,
            timestamp: Math.floor(Date.now() / 1000),
          };
          await sendEnvelope(group, envelope);
        }

        spinner.succeed("Message sent");
      } catch (err) {
        spinner.fail("Failed to send message");
        console.error(
          chalk.red(err instanceof Error ? err.message : String(err)),
        );
        process.exit(1);
      }
    });

  chat
    .command("react <messageId> <emoji>")
    .description("React to a message with an emoji")
    .action(async (messageId: string, emoji: string) => {
      const name = chat.parent?.args[0] as string;
      const spinner = ora("Reacting...").start();
      try {
        const client = await getXmtpClient();
        const group = await getGroup(client, name);
        await xmtpSendReaction(group, messageId, emoji);
        spinner.succeed(`Reacted ${emoji}`);
      } catch (err) {
        spinner.fail("Failed to send reaction");
        console.error(
          chalk.red(err instanceof Error ? err.message : String(err)),
        );
        process.exit(1);
      }
    });

  chat
    .command("log")
    .description("Show recent chat messages")
    .option("--limit <n>", "Number of messages to show", "20")
    .action(async (opts: { limit: string }) => {
      const name = chat.parent?.args[0] as string;
      const spinner = ora("Loading messages...").start();
      try {
        const client = await getXmtpClient();
        const group = await getGroup(client, name);
        const messages = await getRecentMessages(
          group,
          parseInt(opts.limit, 10),
        );

        spinner.stop();
        console.log();
        console.log(
          chalk.bold(`Chat log: ${name}.sherwoodagent.eth`),
        );
        console.log(chalk.dim("─".repeat(50)));

        if (messages.length === 0) {
          console.log(chalk.dim("  No messages yet"));
        } else {
          // Messages come newest-first, reverse for chronological display
          for (const msg of messages.reverse()) {
            console.log(formatMessage(msg));
          }
        }
        console.log();
      } catch (err) {
        spinner.fail("Failed to load messages");
        console.error(
          chalk.red(err instanceof Error ? err.message : String(err)),
        );
        process.exit(1);
      }
    });

  chat
    .command("members")
    .description("List chat group members")
    .action(async () => {
      const name = chat.parent?.args[0] as string;
      const spinner = ora("Loading members...").start();
      try {
        const client = await getXmtpClient();
        const group = await getGroup(client, name);
        const members = await group.members();

        spinner.stop();
        console.log();
        console.log(chalk.bold(`Members: ${name}.sherwoodagent.eth`));
        console.log(chalk.dim("─".repeat(50)));

        for (const member of members) {
          const role = member.permissionLevel === PermissionLevel.SuperAdmin
            ? chalk.yellow(" (super admin)")
            : member.permissionLevel === PermissionLevel.Admin
              ? chalk.blue(" (admin)")
              : "";
          console.log(`  ${member.inboxId}${role}`);
        }

        console.log(chalk.dim(`\n  Total: ${members.length} members`));
        console.log();
      } catch (err) {
        spinner.fail("Failed to load members");
        console.error(
          chalk.red(err instanceof Error ? err.message : String(err)),
        );
        process.exit(1);
      }
    });

  chat
    .command("add <address>")
    .description("Add a member to the chat (creator only)")
    .action(async (address: string) => {
      const name = chat.parent?.args[0] as string;
      const spinner = ora("Adding member...").start();
      try {
        const client = await getXmtpClient();
        const group = await getGroup(client, name);
        await addMember(group, address);

        // Post lifecycle message
        await sendEnvelope(group, {
          type: "MEMBER_JOIN",
          from: address,
          syndicate: name,
          timestamp: Math.floor(Date.now() / 1000),
        });

        spinner.succeed(`Member added: ${address}`);
      } catch (err) {
        spinner.fail("Failed to add member");
        console.error(
          chalk.red(err instanceof Error ? err.message : String(err)),
        );
        process.exit(1);
      }
    });
}
