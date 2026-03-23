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

// =========================
// 🚀 REGISTER COMMAND
// =========================
client.once(Events.ClientReady, async (client) => {
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

// =========================
// 📋 INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {

  try {

    // =========================
    // 🚀 START
    // =========================
    if (interaction.isChatInputCommand() && interaction.commandName === "broadcast") {

      await interaction.guild.roles.fetch();

      const roles = interaction.guild.roles.cache
        .filter(r => r.name !== "@everyone" && !r.managed)
        .map(r => r.name)
        .slice(0, 25);

      const select = new StringSelectMenuBuilder()
        .setCustomId("select_companies")
        .setPlaceholder("Select companies")
        .setMinValues(1)
        .setMaxValues(Math.min(roles.length + 1, 25))
        .addOptions([
          { label: "ALL", value: "all" },
          ...roles.map(r => ({ label: r, value: r }))
        ]);

      await interaction.reply({
        content: "🎯 Select companies:",
        components: [new ActionRowBuilder().addComponents(select)],
        ephemeral: true
      });

      return;
    }

    // =========================
    // 📌 DROPDOWN → MODAL
    // =========================
    if (interaction.isStringSelectMenu() && interaction.customId === "select_companies") {

      // 🔥 prevent double execution
      if (interaction.replied || interaction.deferred) return;

      session.set(interaction.user.id, {
        targets: interaction.values
      });

      const modal = new ModalBuilder()
        .setCustomId("broadcast_modal")
        .setTitle("Broadcast Message");

      const messageInput = new TextInputBuilder()
        .setCustomId("message")
        .setLabel("Message")
        .setStyle(TextInputStyle.Paragraph);

      const delayInput = new TextInputBuilder()
        .setCustomId("delay")
        .setLabel("Delay (10m, 1h optional)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(messageInput),
        new ActionRowBuilder().addComponents(delayInput)
      );

      await interaction.showModal(modal);

      return;
    }

    // =========================
    // 📝 MODAL → PREVIEW
    // =========================
    if (interaction.isModalSubmit() && interaction.customId === "broadcast_modal") {

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

      const members = await interaction.guild.members.fetch();
      const targets = data.targets;
      const targetMembers = [];

      for (const member of members.values()) {

        if (member.user.bot) continue;

        if (
          targets.includes("all") ||
          member.roles.cache.some(role =>
            targets.some(t => isSameCompany(role.name, t))
          )
        ) {
          targetMembers.push(member);
        }
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("back").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({
        content:
          `📢 **Preview**\n\n` +
          `🎯 ${targets.join(", ")}\n` +
          `👥 ${targetMembers.length} users\n` +
          `⏱️ ${timeRaw || "no delay"}\n\n` +
          `💬 ${messageContent}`,
        components: [row],
        ephemeral: true
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
        return interaction.update({ content: "❌ Cancelled.", components: [] });
      }

      // ⬅ BACK
      if (interaction.customId === "back") {

        await interaction.guild.roles.fetch();

        const roles = interaction.guild.roles.cache
          .filter(r => r.name !== "@everyone" && !r.managed)
          .map(r => r.name)
          .slice(0, 25);

        const select = new StringSelectMenuBuilder()
          .setCustomId("select_companies")
          .setPlaceholder("Select companies")
          .setMinValues(1)
          .setMaxValues(Math.min(roles.length + 1, 25))
          .addOptions([
            { label: "ALL", value: "all" },
            ...roles.map(r => ({ label: r, value: r }))
          ]);

        return interaction.update({
          content: "🎯 Select companies again:",
          components: [new ActionRowBuilder().addComponents(select)]
        });
      }

      // ✅ CONFIRM
      if (interaction.customId === "confirm") {

        const { targetMembers, messageContent, delay, targets } = data;

        await interaction.update({
          content: delay ? `⏳ Scheduled...` : "🚀 Sending...",
          components: []
        });

        setTimeout(async () => {

          let success = 0;
          let failed = 0;

          for (const member of targetMembers) {

            try {
              const embed = new EmbedBuilder()
                .setColor(targets.includes("all") ? 0x2ecc71 : 0x3498db)
                .setTitle(targets.includes("all") ? "📢 Announcement" : "📢 Company Update")
                .setDescription(messageContent)
                .setFooter({ text: "Inter Molds, Inc." })
                .setTimestamp();

              await member.send({ embeds: [embed] });
              success++;

            } catch {
              failed++;
            }
          }

          await interaction.followUp({
            content:
              `✅ **Completed**\n\n` +
              `👥 Sent: ${success}\n` +
              `❌ Failed: ${failed}`
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
