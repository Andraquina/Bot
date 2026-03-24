const {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const session = new Map();
const guildMemberCache = new Map();

// =========================
// 🚀 REGISTER COMMAND
// =========================
client.once(Events.ClientReady, async () => {
  console.log('🔥 BOT READY');

  const commands = [
    new SlashCommandBuilder()
      .setName('broadcast')
      .setDescription('Send broadcast with dropdown UI')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      process.env.CLIENT_ID,
      process.env.GUILD_ID
    ),
    { body: commands }
  );

  console.log("✅ Command registered");
});

// =========================
// 🧠 HELPERS
// =========================
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSameCompany(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  return na.includes(nb) || nb.includes(na);
}

async function buildDropdown(guild, selected = []) {
  await guild.roles.fetch();

  const roles = guild.roles.cache
    .filter(r => r.name !== "@everyone" && !r.managed)
    .map(r => r.name)
    .slice(0, 25);

  return new StringSelectMenuBuilder()
    .setCustomId("select_companies")
    .setPlaceholder("Select companies")
    .setMinValues(1)
    .setMaxValues(Math.min(roles.length + 1, 25))
    .addOptions([
      { label: "ALL", value: "all", default: selected.includes("all") },
      ...roles.map(r => ({
        label: r,
        value: r,
        default: selected.includes(r)
      }))
    ]);
}

// =========================
// 📋 INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {

  try {

    // =========================
    // 🚀 START
    // =========================
    if (interaction.isChatInputCommand() && interaction.commandName === "broadcast") {

      const dropdown = await buildDropdown(interaction.guild);

      const msg = await interaction.reply({
        content: "🎯 Select companies:",
        components: [new ActionRowBuilder().addComponents(dropdown)]
      });

      session.set(interaction.user.id, {
        message: msg
      });

      return;
    }

    // =========================
    // 📌 DROPDOWN → MODAL
    // =========================
    if (interaction.isStringSelectMenu() && interaction.customId === "select_companies") {

      if (interaction.replied || interaction.deferred) return;

      const data = session.get(interaction.user.id) || {};

      session.set(interaction.user.id, {
        ...data,
        targets: interaction.values
      });

      const modal = new ModalBuilder()
        .setCustomId("broadcast_modal")
        .setTitle("Broadcast Message");

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("message")
            .setLabel("Message")
            .setStyle(TextInputStyle.Paragraph)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("delay")
            .setLabel("Delay (10m, 1h optional)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        )
      );

      await interaction.showModal(modal);
      return;
    }

    // =========================
    // 📝 MODAL → PREVIEW (FINAL FIX)
    // =========================
    if (interaction.isModalSubmit() && interaction.customId === "broadcast_modal") {

      if (interaction.replied || interaction.deferred) return;

      // ✅ SILENT ACK (NO ERROR, NO "THINKING")
      await interaction.deferUpdate();

      const data = session.get(interaction.user.id);
      if (!data) return;

      const messageContent = interaction.fields.getTextInputValue("message");
      const timeRaw = interaction.fields.getTextInputValue("delay");

      let delay = 0;
      if (timeRaw) {
        const num = parseInt(timeRaw);
        if (timeRaw.includes("m")) delay = num * 60000;
        else if (timeRaw.includes("h")) delay = num * 3600000;
      }

      // MEMBER CACHE
      let members = guildMemberCache.get(interaction.guild.id);

      if (!members) {
        members = await interaction.guild.members.fetch();
        guildMemberCache.set(interaction.guild.id, members);
      }

      const targets = data.targets;

      const targetMembers = members.filter(m =>
        !m.user.bot &&
        (
          targets.includes("all") ||
          m.roles.cache.some(r => targets.some(t => isSameCompany(r.name, t)))
        )
      );

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("back").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger)
      );

      await data.message.edit({
        content:
          `📢 **Preview**\n\n` +
          `🎯 ${targets.join(", ")}\n` +
          `👥 ${targetMembers.size} users\n` +
          `⏱️ ${timeRaw || "no delay"}\n\n` +
          `💬 ${messageContent}`,
        components: [buttons]
      });

      session.set(interaction.user.id, {
        ...data,
        messageContent,
        delay,
        targetMembers
      });

      return;
    }

    // =========================
    // 🔘 BUTTONS
    // =========================
    if (interaction.isButton()) {

      const data = session.get(interaction.user.id);
      if (!data) return;

      // ❌ CANCEL
      if (interaction.customId === "cancel") {
        session.delete(interaction.user.id);
        return interaction.update({
          content: "❌ Cancelled.",
          components: []
        });
      }

      // ⬅ BACK
      if (interaction.customId === "back") {

        const dropdown = await buildDropdown(interaction.guild, data.targets);

        session.set(interaction.user.id, {
          message: data.message
        });

        return interaction.update({
          content: "🎯 Select companies:",
          components: [new ActionRowBuilder().addComponents(dropdown)]
        });
      }

      // ✅ CONFIRM
      if (interaction.customId === "confirm") {

        const { targetMembers, messageContent, delay, targets } = data;

        await interaction.update({
          content: delay ? "⏳ Scheduled..." : "🚀 Sending...",
          components: []
        });

        setTimeout(async () => {

          let success = 0;
          let failed = 0;

          for (const member of targetMembers.values()) {
            try {
              await member.send({
                embeds: [
                  new EmbedBuilder()
                    .setColor(targets.includes("all") ? 0x2ecc71 : 0x3498db)
                    .setTitle(targets.includes("all") ? "📢 Announcement" : "📢 Company Update")
                    .setDescription(messageContent)
                    .setFooter({ text: "Inter Molds, Inc." })
                    .setTimestamp()
                ]
              });
              success++;
            } catch {
              failed++;
            }
          }

          await interaction.followUp({
            content:
              `✅ **Broadcast Completed**\n\n` +
              `👥 Sent: ${success}\n` +
              `❌ Failed: ${failed}\n\n` +
              `💬 ${messageContent}`
          });

        }, delay);

        session.delete(interaction.user.id);
      }
    }

  } catch (err) {
    console.error("ERROR:", err);
  }
});

client.login(process.env.TOKEN);
