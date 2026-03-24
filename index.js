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

// Global States
const session = new Map();
const repliedUsers = new Set();
const onboardingData = new Map(); // Stores pending approvals

// =========================
// 🚀 ON READY & REGISTER
// =========================
client.once(Events.ClientReady, async () => {
  console.log('🔥 BOT IS ONLINE');
  const commands = [
    new SlashCommandBuilder().setName('setup-broadcast').setDescription('Create broadcast panel')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("✅ Slash Commands registered");
  } catch (error) { console.error("Registration Error:", error); }
});

// =========================
// 🧠 HELPERS
// =========================
function normalize(str) { return str.toLowerCase().replace(/[^a-z0-9]/g, ''); }

function isSameCompany(a, b) {
  const na = normalize(a); const nb = normalize(b);
  return na.includes(nb) || nb.includes(na);
}

async function buildDropdown(guild, selected = []) {
  await guild.roles.fetch();
  const roles = guild.roles.cache
    .filter(r => r.name !== "@everyone" && !r.managed)
    .map(r => r.name).slice(0, 24);

  return new StringSelectMenuBuilder()
    .setCustomId("select_companies")
    .setPlaceholder("Select targets")
    .setMinValues(1)
    .setMaxValues(Math.min(roles.length + 1, 25))
    .addOptions([
      { label: "ALL", value: "all", default: selected.includes("all") },
      ...roles.map(r => ({ label: r, value: r, default: selected.includes(r) }))
    ]);
}

// =========================
// 👋 ON USER JOIN
// =========================
client.on(Events.GuildMemberAdd, async member => {
  const channel = member.guild.channels.cache.find(c => c.name.toLowerCase().includes("welcome"));
  if (!channel) return;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('open_onboarding_modal').setLabel('Start Setup').setStyle(ButtonStyle.Primary)
  );

  await channel.send({
    content: `Welcome <@${member.id}>! To access the server, please click the button below to register.`,
    components: [row]
  });
});

// =========================
// 📩 DM AUTO RESPONSE
// =========================
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || message.guild) return;
  if (repliedUsers.has(message.author.id)) return;
  await message.reply("📩 **Inter Molds System**\nThis bot is for notifications only. Contact official channels for help.");
  repliedUsers.add(message.author.id);
});

// =========================
// 📋 INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {
    // 1. AUTOCOMPLETE
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused() || "";
      const roles = interaction.guild.roles.cache.filter(r => r.name !== "@everyone").map(r => r.name);
      const results = roles.filter(r => r.toLowerCase().includes(focused.toLowerCase())).slice(0, 25);
      return await interaction.respond(results.map(r => ({ name: r, value: r })));
    }

    // 2. SLASH COMMANDS
    if (interaction.isChatInputCommand() && interaction.commandName === "setup-broadcast") {
      const btn = new ButtonBuilder().setCustomId("start_broadcast").setLabel("📢 Start Broadcast").setStyle(ButtonStyle.Primary);
      await interaction.channel.send({ content: "📢 **Broadcast Panel**", components: [new ActionRowBuilder().addComponents(btn)] });
      return interaction.reply({ content: "Panel created.", ephemeral: true });
    }

    // 3. BUTTONS
    if (interaction.isButton()) {
      // --- ONBOARDING: OPEN MODAL ---
      if (interaction.customId === 'open_onboarding_modal') {
        const modal = new ModalBuilder().setCustomId('onboarding_modal').setTitle('Company Registration');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_name').setLabel('Your Full Name').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('company_name').setLabel('Your Company').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
      }

      // --- ONBOARDING: ADMIN APPROVAL/DENY ---
      if (interaction.customId.startsWith('approve_') || interaction.customId.startsWith('deny_')) {
        const [action, userId] = interaction.customId.split('_');
        const data = onboardingData.get(userId);
        if (!data) return interaction.reply({ content: "Session expired or already handled.", ephemeral: true });

        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!member) return interaction.reply({ content: "User is no longer in the server.", ephemeral: true });

        if (action === 'approve') {
          // Find/Create Role
          let role = interaction.guild.roles.cache.find(r => isSameCompany(r.name, data.company));
          if (!role) {
            role = await interaction.guild.roles.create({ name: data.company, color: 'Blue', reason: 'Onboarding' });
          }
          await member.roles.add(role);

          // Create Category & Channels
          const category = await interaction.guild.channels.create({
            name: data.company.toUpperCase(),
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
              { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
              { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] }
            ]
          });

          await interaction.guild.channels.create({ name: `text-chat`, type: ChannelType.GuildText, parent: category.id });
          await interaction.guild.channels.create({ name: `voice-chat`, type: ChannelType.GuildVoice, parent: category.id });

          try {
            await member.send(`✅ **Approved!** Welcome to **${data.company}**.\n\n**Rules:**\n1. Be professional.\n2. Respect privacy.`);
          } catch (e) { console.log("DM failed."); }

          await interaction.update({ content: `✅ Approved ${data.name} (${data.company})`, components: [] });
        } else {
          await interaction.update({ content: `❌ Denied ${data.name}`, components: [] });
        }
        onboardingData.delete(userId);
        return;
      }

      // --- BROADCAST: START ---
      if (interaction.customId === "start_broadcast") {
        const dropdown = await buildDropdown(interaction.guild);
        const msg = await interaction.reply({ content: "🎯 Select targets:", components: [new ActionRowBuilder().addComponents(dropdown)], fetchReply: true });
        session.set(interaction.user.id, { message: msg });
        return;
      }

      // --- BROADCAST: CONFIRM/CANCEL ---
      const bData = session.get(interaction.user.id);
      if (interaction.customId === "confirm" && bData) {
        const { targetMembers, messageContent, message, targets } = bData;
        await interaction.update({ content: `🚀 Sending to ${targetMembers.size} users...`, components: [] });
        let success = 0;
        for (const m of targetMembers.values()) {
          try {
            await m.send({ embeds: [new EmbedBuilder().setTitle("📢 Update").setDescription(messageContent).setColor("Blue").setTimestamp()] });
            success++;
          } catch (e) {}
        }
        await message.edit({ content: `✅ Sent to ${success} users.` });
        session.delete(interaction.user.id);
      }
    }

    // 4. MODALS SUBMIT
    if (interaction.isModalSubmit()) {
      // ONBOARDING SUBMISSION
      if (interaction.customId === 'onboarding_modal') {
        const name = interaction.fields.getTextInputValue('user_name');
        const company = interaction.fields.getTextInputValue('company_name');
        onboardingData.set(interaction.user.id, { name, company });

        const adminChan = interaction.guild.channels.cache.find(c => c.name.toLowerCase().includes("admin"));
        if (!adminChan) return interaction.reply({ content: "Error: No admin channel.", ephemeral: true });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );

        await adminChan.send({ content: `🔔 **New Request**\n**User:** <@${interaction.user.id}>\n**Name:** ${name}\n**Company:** ${company}`, components: [row] });
        return interaction.reply({ content: "✅ Submitted. Wait for approval.", ephemeral: true });
      }

      // BROADCAST SUBMISSION
      if (interaction.customId === "broadcast_modal") {
        await interaction.deferUpdate();
        const data = session.get(interaction.user.id);
        const text = interaction.fields.getTextInputValue("message");
        const members = await interaction.guild.members.fetch();
        const targets = members.filter(m => !m.user.bot && (data.targets.includes("all") || m.roles.cache.some(r => data.targets.some(t => isSameCompany(r.name, t)))));

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger)
        );

        await data.message.edit({ content: `📢 **Preview**\nReach: ${targets.size} users\n\n${text}`, components: [row] });
        session.set(interaction.user.id, { ...data, messageContent: text, targetMembers: targets });
      }
    }

    // 5. SELECT MENU (Broadcast)
    if (interaction.isStringSelectMenu() && interaction.customId === "select_companies") {
      session.set(interaction.user.id, { ...session.get(interaction.user.id), targets: interaction.values });
      const modal = new ModalBuilder().setCustomId("broadcast_modal").setTitle("Message");
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("message").setLabel("Text").setStyle(TextInputStyle.Paragraph)));
      await interaction.showModal(modal);
    }

  } catch (err) { console.error(err); }
});

client.login(process.env.TOKEN);
