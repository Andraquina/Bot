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
const lastBroadcast = new Map();

let panelMessage = null;

// =========================
// 🚀 REGISTER COMMAND
// =========================
client.once(Events.ClientReady, async () => {
  console.log('🔥 BOT READY');

  const commands = [
    new SlashCommandBuilder()
      .setName('setup-broadcast')
      .setDescription('Create broadcast panel')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );

  console.log("✅ Commands registered");
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

async function createPanel(channel) {
  const button = new ButtonBuilder()
    .setCustomId("start_broadcast")
    .setLabel("📢 Start Broadcast")
    .setStyle(ButtonStyle.Primary);

  return await channel.send({
    content: "📢 **Broadcast Panel**\nClick below to start:",
    components: [new ActionRowBuilder().addComponents(button)]
  });
}

// =========================
// 📋 INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {

  try {

    // SETUP PANEL
    if (interaction.isChatInputCommand() && interaction.commandName === "setup-broadcast") {

      panelMessage = await createPanel(interaction.channel);

      return interaction.reply({
        content: "✅ Panel created. (Tip: pin it for easy access)",
        ephemeral: true
      });
    }

    // START
    if (interaction.isButton() && interaction.customId === "start_broadcast") {

      const dropdown = await buildDropdown(interaction.guild);

      const msg = await interaction.reply({
        content: "🎯 Select companies:",
        components: [new ActionRowBuilder().addComponents(dropdown)]
      });

      session.set(interaction.user.id, { message: msg });
      return;
    }

    // DROPDOWN
    if (interaction.isStringSelectMenu()) {

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
            .setLabel("Delay (10m optional)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        )
      );

      await interaction.showModal(modal);
      return;
    }

    // MODAL
    if (interaction.isModalSubmit()) {

      await interaction.deferUpdate();

      const data = session.get(interaction.user.id);
      if (!data) return;

      const messageContent = interaction.fields.getTextInputValue("message");
      const targets = data.targets;

      let members = guildMemberCache.get(interaction.guild.id);
      if (!members) {
        members = await interaction.guild.members.fetch();
        guildMemberCache.set(interaction.guild.id, members);
      }

      const targetMembers = members.filter(m =>
        !m.user.bot &&
        (
          targets.includes("all") ||
          m.roles.cache.some(r => targets.some(t => isSameCompany(r.name, t)))
        )
      );

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("template").setLabel("Use Last").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger)
      );

      await data.message.edit({
        content:
          `📢 **Preview**\n\n` +
          `🎯 Targets: ${targets.join(", ")}\n` +
          `👥 Users: ${targetMembers.size}\n\n` +
          `💬 ${messageContent}`,
        components: [buttons]
      });

      session.set(interaction.user.id, {
        ...data,
        messageContent,
        targetMembers
      });
    }

    // BUTTONS
    if (interaction.isButton()) {

      const data = session.get(interaction.user.id);
      if (!data) return;

      if (interaction.customId === "cancel") {
        session.delete(interaction.user.id);
        return interaction.update({ content: "❌ Cancelled.", components: [] });
      }

      if (interaction.customId === "template") {
        const template = lastBroadcast.get(interaction.guild.id);
        if (!template) return interaction.reply({ content: "❌ No template.", ephemeral: true });

        return interaction.update({
          content:
            `📄 Loaded Template\n\n` +
            `🎯 ${template.targets.join(", ")}\n\n` +
            `💬 ${template.messageContent}`,
          components: []
        });
      }

      if (interaction.customId === "confirm") {

        const { targetMembers, messageContent, message, targets } = data;

        await interaction.update({
          content: `🚀 Sending... (0/${targetMembers.size})`,
          components: []
        });

        let i = 0;
        let success = 0;
        let failed = 0;

        for (const member of targetMembers.values()) {
          i++;

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

          if (i % 2 === 0 || i === targetMembers.size) {
            await message.edit({
              content: `🚀 Sending... (${i}/${targetMembers.size})`
            });
          }
        }

        await message.edit({
          content:
            `✅ **Broadcast Completed**\n\n` +
            `🎯 Targets: ${targets.join(", ")}\n` +
            `👥 Sent: ${success}\n` +
            `❌ Failed: ${failed}\n\n` +
            `💬 ${messageContent}`
        });

        lastBroadcast.set(interaction.guild.id, { messageContent, targets });
        session.delete(interaction.user.id);
      }
    }

  } catch (err) {
    console.error(err);
  }
});

client.login(process.env.TOKEN);
