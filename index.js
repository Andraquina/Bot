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

// Consolidated Client with all required Intents and Partials
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

// Broadcast Sessions and Caches
const session = new Map();
const guildMemberCache = new Map();
const repliedUsers = new Set();

// =========================
// 🚀 ON READY & REGISTER COMMANDS
// =========================
client.once(Events.ClientReady, async () => {
  console.log('🔥 BOT IS ONLINE');

  const commands = [
    new SlashCommandBuilder()
      .setName('setup-broadcast')
      .setDescription('Create broadcast panel')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("✅ Commands registered");
  } catch (error) {
    console.error("Error registering commands:", error);
  }
});

// =========================
// 🧠 HELPERS
// =========================
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatWords(str) {
  return str.toLowerCase().split(/\s+/).filter(w => w.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function getAcronym(company) {
  const words = company.toLowerCase().split(/\s+/);
  if (words.length === 1) return company;
  return words.map(w => w[0].toUpperCase()).join('');
}

function isSameCompany(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const acA = getAcronym(a).toLowerCase();
  const acB = getAcronym(b).toLowerCase();
  if (acA === nb || acB === na) return true;
  return false;
}

async function buildDropdown(guild, selected = []) {
  await guild.roles.fetch();
  const roles = guild.roles.cache
    .filter(r => r.name !== "@everyone" && !r.managed)
    .map(r => r.name)
    .slice(0, 24); // Keep room for 'ALL'

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
// 📩 DM AUTO RESPONSE
// =========================
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guild) {
    if (repliedUsers.has(message.author.id)) return;
    await message.reply(
      "📩 **Inter Molds System**\n\n" +
      "This bot is used for notifications only.\n" +
      "We do not receive or monitor messages sent here.\n\n" +
      "If you need assistance, please contact us through our official channels."
    );
    repliedUsers.add(message.author.id);
  }
});

// =========================
// 👋 ON USER JOIN
// =========================
client.on(Events.GuildMemberAdd, async member => {
  const channel = member.guild.channels.cache.find(c => c.name === "welcome");
  if (!channel) return;

  const button = new ButtonBuilder()
    .setCustomId('open_form')
    .setLabel('Start Setup')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  await channel.send({
    content: `<@${member.id}> Welcome! Click below to get started:`,
    components: [row]
  });
});

// =========================
// 📋 INTERACTIONS (Merged Logic)
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {
    // 1. AUTOCOMPLETE
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused() || "";
      const parts = focused.split(";");
      const current = parts[parts.length - 1].trim().toLowerCase();

      const roles = interaction.guild.roles.cache
        .filter(r => r.name !== "@everyone")
        .map(r => r.name);

      const starts = roles.filter(r => r.toLowerCase().startsWith(current));
      const includes = roles.filter(r => r.toLowerCase().includes(current) && !starts.includes(r));
      let results = [...starts, ...includes];

      const selected = parts.slice(0, -1).map(p => p.trim().toLowerCase());
      results = results.filter(r => !selected.includes(r.toLowerCase()));

      if (!selected.includes("all")) results.unshift("ALL");

      const suggestions = results.slice(0, 25).map(name => {
        const newParts = [...parts];
        newParts[newParts.length - 1] = name;
        return { name: newParts.join("; "), value: newParts.join("; ") };
      });

      return await interaction.respond(suggestions);
    }

    // 2. SLASH COMMANDS
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "setup-broadcast") {
        await createPanel(interaction.channel);
        return interaction.reply({ content: "✅ Panel created.", ephemeral: true });
      }
    }

    // 3. BUTTONS
    if (interaction.isButton()) {
      // Broadcast Start
      if (interaction.customId === "start_broadcast") {
        const dropdown = await buildDropdown(interaction.guild);
        const msg = await interaction.reply({
          content: "🎯 Select companies:",
          components: [new ActionRowBuilder().addComponents(dropdown)],
          fetchReply: true
        });
        session.set(interaction.user.id, { message: msg });
        return;
      }

      // Handle Confirm/Cancel/Back for Broadcast
      const data = session.get(interaction.user.id);
      if (!data) return;

      if (interaction.customId === "cancel") {
        session.delete(interaction.user.id);
        return interaction.update({ content: "❌ Cancelled.", components: [] });
      }

      if (interaction.customId === "back") {
        const dropdown = await buildDropdown(interaction.guild, data.targets);
        return interaction.update({
          content: "🎯 Select companies:",
          components: [new ActionRowBuilder().addComponents(dropdown)]
        });
      }

      if (interaction.customId === "confirm") {
        const { targetMembers, messageContent, message, targets } = data;
        await interaction.update({ content: `🚀 Sending... (0/${targetMembers.size})`, components: [] });

        let success = 0; let failed = 0; let i = 0;
        for (const member of targetMembers.values()) {
          i++;
          try {
            await member.send({
              embeds: [new EmbedBuilder()
                .setColor(targets.includes("all") ? 0x2ecc71 : 0x3498db)
                .setTitle(targets.includes("all") ? "📢 Announcement" : "📢 Company Update")
                .setDescription(messageContent)
                .setFooter({ text: "Inter Molds, Inc." })
                .setTimestamp()]
            });
            success++;
          } catch { failed++; }

          if (i % 5 === 0 || i === targetMembers.size) {
            await message.edit({ content: `🚀 Sending... (${i}/${targetMembers.size})` });
          }
        }
        await message.edit({
          content: `✅ **Broadcast Completed**\n\n🎯 Targets: ${targets.join(", ")}\n👥 Sent: ${success}\n❌ Failed: ${failed}\n\n💬 ${messageContent}`
        });
        session.delete(interaction.user.id);
      }
    }

    // 4. SELECT MENU
    if (interaction.isStringSelectMenu() && interaction.customId === "select_companies") {
      const data = session.get(interaction.user.id) || {};
      session.set(interaction.user.id, { ...data, targets: interaction.values });

      const modal = new ModalBuilder().setCustomId("broadcast_modal").setTitle("Broadcast Message");
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("message").setLabel("Message").setStyle(TextInputStyle.Paragraph)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("delay").setLabel("Delay (optional)").setStyle(TextInputStyle.Short).setRequired(false))
      );
      return await interaction.showModal(modal);
    }

    // 5. MODAL SUBMIT
    if (interaction.isModalSubmit() && interaction.customId === "broadcast_modal") {
      await interaction.deferUpdate();
      const data = session.get(interaction.user.id);
      if (!data) return;

      const messageContent = interaction.fields.getTextInputValue("message");
      const targets = data.targets;

      let members = await interaction.guild.members.fetch();
      const targetMembers = members.filter(m => !m.user.bot && (targets.includes("all") || m.roles.cache.some(r => targets.some(t => isSameCompany(r.name, t)))));

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("back").setLabel("✏️ Edit").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger)
      );

      await data.message.edit({
        content: `📢 **Preview**\n\n🎯 Targets: ${targets.join(", ")}\n👥 Users: ${targetMembers.size}\n\n💬 ${messageContent}`,
        components: [buttons]
      });

      session.set(interaction.user.id, { ...data, messageContent, targetMembers });
    }

  } catch (err) {
    console.error("Interaction Error:", err);
  }
});

client.login(process.env.TOKEN);
