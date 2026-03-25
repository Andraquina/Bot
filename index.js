const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// =========================
// STATE
// =========================
const session = new Map();
const repliedUsers = new Set();
const onboardingData = new Map();

// =========================
// READY
// =========================
client.once(Events.ClientReady, async () => {
  console.log('🔥 BOT IS ONLINE');

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
});

// =========================
// HELPERS
// =========================
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatTitleCase(str) {
  return str.toLowerCase().split(/\s+/)
    .filter(w => w.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getAcronym(company) {
  const words = company.trim().split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 3).toUpperCase();
  return words.map(w => w[0].toUpperCase()).join('');
}

function isSameCompany(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  return na.includes(nb) || nb.includes(na);
}

async function buildDropdown(guild, selected = []) {
  try {
    await guild.roles.fetch();
  } catch (e) {
    console.error("Role fetch failed:", e);
  }

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
// JOIN SYSTEM
// =========================
client.on(Events.GuildMemberAdd, async member => {
  const channel = member.guild.channels.cache.find(c =>
    c.name.toLowerCase().includes("welcome") &&
    c.type === ChannelType.GuildText
  );

  if (!channel) return;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_onboarding_modal')
      .setLabel('Start Setup')
      .setStyle(ButtonStyle.Primary)
  );

  const msg = await channel.send({
    content: `Welcome <@${member.id}>! Click below to register.`,
    components: [row]
  });

  onboardingData.set(member.id, {
    welcomeMsgId: msg.id,
    welcomeChannelId: channel.id
  });
});

// =========================
// INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {

    // =========================
    // BROADCAST PANEL COMMAND
    // =========================
    if (interaction.isChatInputCommand() && interaction.commandName === "setup-broadcast") {

      const button = new ButtonBuilder()
        .setCustomId("start_broadcast")
        .setLabel("📢 Start Broadcast")
        .setStyle(ButtonStyle.Primary);

      await interaction.channel.send({
        content: "📢 **Broadcast Panel**",
        components: [new ActionRowBuilder().addComponents(button)]
      });

      return interaction.reply({ content: "✅ Panel created.", ephemeral: true });
    }

    // =========================
    // BUTTONS
    // =========================
    if (interaction.isButton()) {

      // OPEN FORM
      if (interaction.customId === 'open_onboarding_modal') {
        const modal = new ModalBuilder()
          .setCustomId('onboarding_modal')
          .setTitle('Company Registration');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('user_name')
              .setLabel('Your Name')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('company_name')
              .setLabel('Company')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );

        return interaction.showModal(modal);
      }

      // =========================
      // START BROADCAST
      // =========================
      if (interaction.customId === "start_broadcast") {

        await interaction.deferReply({ ephemeral: true });

        const dropdown = await buildDropdown(interaction.guild);

        const reply = await interaction.editReply({
          content: "🎯 Select companies:",
          components: [new ActionRowBuilder().addComponents(dropdown)]
        });

        session.set(interaction.user.id, { message: reply });
        return;
      }

      // BACK
      if (interaction.customId === "back") {
        const data = session.get(interaction.user.id);
        if (!data) return;

        const dropdown = await buildDropdown(interaction.guild, data.targets);

        return interaction.update({
          content: "🎯 Select companies:",
          components: [new ActionRowBuilder().addComponents(dropdown)]
        });
      }

      // CANCEL
      if (interaction.customId === "cancel") {
        session.delete(interaction.user.id);

        return interaction.update({
          content: "❌ Broadcast cancelled.",
          components: []
        });
      }

      // CONFIRM SEND
      if (interaction.customId === "confirm") {

        const data = session.get(interaction.user.id);
        if (!data) return;

        const { targetMembers, messageContent, message, targets } = data;

        await interaction.update({
          content: `🚀 Sending to ${targetMembers.size} users...`,
          components: []
        });

        let i = 0;
        let success = 0;

        for (const m of targetMembers.values()) {
          i++;

          try {
            await m.send({
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

          } catch (e) {}

          if (i % 2 === 0 || i === targetMembers.size) {
            await message.edit({
              content: `🚀 Sending... (${i}/${targetMembers.size})`
            });
          }
        }

        await message.edit({
          content:
            `✅ **Broadcast Completed**\n` +
            `🎯 Targets: ${targets.join(", ")}\n` +
            `👥 Sent: ${success}`
        });

        session.delete(interaction.user.id);
        return;
      }
    }

    // =========================
    // SELECT MENU
    // =========================
    if (interaction.isStringSelectMenu() && interaction.customId === "select_companies") {

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
            .setRequired(true)
        )
      );

      return interaction.showModal(modal);
    }

    // =========================
    // MODAL SUBMIT
    // =========================
    if (interaction.isModalSubmit()) {

      // ONBOARDING
      if (interaction.customId === 'onboarding_modal') {

        const name = interaction.fields.getTextInputValue('user_name');
        const company = interaction.fields.getTextInputValue('company_name');

        onboardingData.set(interaction.user.id, {
          ...onboardingData.get(interaction.user.id),
          name,
          company
        });

        const adminChan = interaction.guild.channels.cache.find(c =>
          c.name.toLowerCase().includes("admin") &&
          c.type === ChannelType.GuildText
        );

        if (!adminChan) {
          return interaction.reply({
            content: "❌ Admin channel not found.",
            ephemeral: true
          });
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );

        await adminChan.send({
          content:
            `🚨 New company request\n\n` +
            `User: <@${interaction.user.id}>\n` +
            `Name: ${name}\n` +
            `Company: ${company}`,
          components: [row]
        });

        return interaction.reply({
          content: "✅ Request sent to admins.",
          ephemeral: true
        });
      }

      // BROADCAST MODAL
      if (interaction.customId === "broadcast_modal") {

        await interaction.deferUpdate();

        const data = session.get(interaction.user.id);
        if (!data) return;

        const text = interaction.fields.getTextInputValue("message");

        const members = await interaction.guild.members.fetch();

        const targetMembers = members.filter(m =>
          !m.user.bot &&
          (
            data.targets.includes("all") ||
            m.roles.cache.some(r =>
              data.targets.some(t => isSameCompany(r.name, t))
            )
          )
        );

        const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("back").setLabel("✏️ Edit").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger)
        );

        await data.message.edit({
          content:
            `📢 **Preview**\n\n` +
            `🎯 Targets: ${data.targets.join(", ")}\n` +
            `👥 Users: ${targetMembers.size}\n\n` +
            `💬 ${text}`,
          components: [buttons]
        });

        session.set(interaction.user.id, {
          ...data,
          messageContent: text,
          targetMembers
        });

        return;
      }
    }

  } catch (err) {
    console.error("Interaction Error:", err);
  }
});

// =========================
// DM SYSTEM
// =========================
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || message.guild) return;
  if (repliedUsers.has(message.author.id)) return;

  await message.reply("📩 **Inter Molds System**\nThis bot is for notifications only.");
  repliedUsers.add(message.author.id);
});

client.login(process.env.TOKEN);
