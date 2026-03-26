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
  console.log('🔥 IMI SYSTEM ONLINE');

  const commands = [
    new SlashCommandBuilder().setName('setup-broadcast').setDescription('Create broadcast panel'),
    new SlashCommandBuilder().setName('create-production').setDescription('Create the permanent Production Channel button')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log("✅ Commands registered");
  } catch (error) { console.error(error); }
});

// =========================
// 🧠 HELPERS
// =========================
function normalize(str) { return str.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function formatWords(str) {
  if (!str) return "";
  return str.toLowerCase().split(/\s+/).filter(w => w.length > 0).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
function getAcronym(company) {
  const words = company.split(/\s+/);
  return words.length === 1 ? company.substring(0, 3).toUpperCase() : words.map(w => w[0].toUpperCase()).join('');
}
function isSameCompany(a, b) { return normalize(a).includes(normalize(b)) || normalize(b).includes(normalize(a)); }

async function buildDropdown(guild, selected = [], customId = "select_companies") {
  await guild.roles.fetch();
  const roles = guild.roles.cache.filter(r => r.name !== "@everyone" && !r.managed).map(r => r.name).slice(0, 25);
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Select company")
    .setMinValues(1)
    .setMaxValues(customId === "prod_select" ? 1 : Math.min(roles.length + 1, 25))
    .addOptions([
      ...(customId === "prod_select" ? [] : [{ label: "ALL", value: "all", default: selected.includes("all") }]),
      ...roles.map(r => ({ label: r, value: r, default: selected.includes(r) }))
    ]);
}

// =========================
// 👋 JOIN (5-Minute Idle Timer)
// =========================
client.on(Events.GuildMemberAdd, async member => {
  const channel = member.guild.channels.cache.find(c => c.name.toLowerCase().includes("welcome"));
  if (!channel) return;
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_onboarding_modal').setLabel('Start Setup').setStyle(ButtonStyle.Primary));
  const msg = await channel.send({ content: `<@${member.id}> Welcome! Click below to start. You have **5 minutes**.`, components: [row] });
  onboardingData.set(member.id, { welcomeMsgId: msg.id, welcomeChannelId: channel.id, status: 'idle' });
  
  setTimeout(async () => {
    const data = onboardingData.get(member.id);
    if (data && data.status === 'idle') {
      try {
        const welcomeChannel = member.guild.channels.cache.get(data.welcomeChannelId);
        if (welcomeChannel) {
          const m = await welcomeChannel.messages.fetch(data.welcomeMsgId).catch(() => null);
          if (m) await m.delete().catch(() => {});
        }
        await member.kick("Onboarding timeout").catch(() => {});
      } catch (e) {} finally { onboardingData.delete(member.id); }
    }
  }, 5 * 60 * 1000);
});

// =========================
// 📋 INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "setup-broadcast") {
        const btn = new ButtonBuilder().setCustomId("start_broadcast").setLabel("📢 Start Broadcast").setStyle(ButtonStyle.Primary);
        await interaction.channel.send({ content: "📢 **Broadcast Panel**", components: [new ActionRowBuilder().addComponents(btn)] });
        return interaction.reply({ content: "✅ Panel created.", ephemeral: true });
      }
      if (interaction.commandName === "create-production") {
        const btn = new ButtonBuilder().setCustomId("start_production").setLabel("🏗️ Create Production").setStyle(ButtonStyle.Success);
        await interaction.channel.send({ content: "🏗️ **Production Panel**", components: [new ActionRowBuilder().addComponents(btn)] });
        return interaction.reply({ content: "✅ Production Panel created.", ephemeral: true });
      }
    }

    if (interaction.isModalSubmit()) {
      const data = session.get(interaction.user.id);
      
      if (interaction.customId === "broadcast_modal") {
        await interaction.deferUpdate();
        if (!data) return;
        const messageContent = interaction.fields.getTextInputValue("message");
        const members = await interaction.guild.members.fetch();
        const targetMembers = members.filter(m => !m.user.bot && (data.targets.includes("all") || m.roles.cache.some(r => data.targets.some(t => isSameCompany(r.name, t)))));
        const btns = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("confirm_bc").setLabel("Confirm").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("cancel_flow").setLabel("Cancel").setStyle(ButtonStyle.Danger)
        );
        await data.message.edit({ content: `📢 **Broadcast Preview**\nTargets: ${data.targets.join(", ")}\nMessage: ${messageContent}`, components: [btns] });
        session.set(interaction.user.id, { ...data, messageContent, targetMembers });
      }

      if (interaction.customId === "production_modal") {
        await interaction.deferUpdate();
        if (!data) return;
        const moldName = interaction.fields.getTextInputValue("mold_name");
        const btns = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("confirm_prod").setLabel("Confirm Creation").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("cancel_flow").setLabel("Cancel").setStyle(ButtonStyle.Danger)
        );
        await data.message.edit({ content: `🏗️ **Production Preview**\nCompany: **${data.targets[0]}**\nMold Name: **${moldName}**`, components: [btns] });
        session.set(interaction.user.id, { ...data, moldName });
      }

      if (interaction.customId === 'onboarding_modal') {
        const name = interaction.fields.getTextInputValue('user_name');
        const company = interaction.fields.getTextInputValue('company_name');
        const currentData = onboardingData.get(interaction.user.id) || {};
        onboardingData.set(interaction.user.id, { ...currentData, name, company, status: 'submitted' });
        const adminChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase().includes("admin"));
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`approve_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger));
        await adminChannel.send({ content: `🚨 New request\nUser: <@${interaction.user.id}>\nName: ${name}\nCompany: ${company}`, components: [row] });
        if (currentData.welcomeMsgId) {
          const welcomeChannel = interaction.guild.channels.cache.get(currentData.welcomeChannelId);
          if (welcomeChannel) welcomeChannel.messages.fetch(currentData.welcomeMsgId).then(m => m.delete().catch(() => {}));
        }
        return interaction.reply({ content: "✅ Info submitted.", ephemeral: true });
      }
    }

    if (interaction.isButton()) {
      const data = session.get(interaction.user.id);
      
      if (interaction.customId === "start_broadcast") {
        const dropdown = await buildDropdown(interaction.guild, [], "select_companies");
        const msg = await interaction.channel.send({ content: "🎯 **Broadcast Setup**\nSelect target companies:", components: [new ActionRowBuilder().addComponents(dropdown)] });
        session.set(interaction.user.id, { message: msg });
        return interaction.reply({ content: "Broadcast Setup started below.", ephemeral: true });
      }

      if (interaction.customId === "start_production") {
        const dropdown = await buildDropdown(interaction.guild, [], "prod_select");
        const msg = await interaction.channel.send({ content: "🏗️ **Production Setup**\nSelect company role:", components: [new ActionRowBuilder().addComponents(dropdown)] });
        session.set(interaction.user.id, { message: msg });
        return interaction.reply({ content: "Production Setup started below.", ephemeral: true });
      }

      if (interaction.customId === "confirm_bc" && data) {
        await interaction.update({ content: `🚀 Sending broadcast...`, components: [] });
        let success = 0;
        for (const m of data.targetMembers.values()) {
          try { await m.send({ embeds: [new EmbedBuilder().setColor(0x3498db).setTitle("📢 Announcement").setDescription(data.messageContent).setFooter({ text: "Inter Molds, Inc." }).setTimestamp()] }); success++; } catch {}
        }
        await interaction.channel.send({ content: `✅ **Broadcast Completed**\n👥 Sent to: ${success} members.` });
        setTimeout(() => data.message.delete().catch(() => {}), 3000);
        session.delete(interaction.user.id);
      }

      if (interaction.customId === "confirm_prod" && data) {
        await interaction.update({ content: `🏗️ Creating channel...`, components: [] });
        const role = interaction.guild.roles.cache.find(r => r.name === data.targets[0]);
        const category = interaction.guild.channels.cache.find(c => c.name === role.name && c.type === ChannelType.GuildCategory);
        const basicPerms = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.AddReactions, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak];
        const newChan = await interaction.guild.channels.create({
          name: data.moldName, type: ChannelType.GuildText, parent: category.id,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: role.id, allow: basicPerms, deny: [PermissionsBitField.Flags.MentionEveryone, PermissionsBitField.Flags.ManageMessages] }
          ]
        });
        await newChan.send(`🏗️ **Production Channel Created**\nTracking for **${data.moldName}**.`);
        await interaction.channel.send({ content: `✅ **Production Channel Created**: <#${newChan.id}>` });
        setTimeout(() => data.message.delete().catch(() => {}), 3000);
        session.delete(interaction.user.id);
      }

      if (interaction.customId === "cancel_flow" && data) {
        await data.message.delete().catch(() => {});
        session.delete(interaction.user.id);
        return interaction.reply({ content: "❌ Session Cancelled.", ephemeral: true });
      }

      if (interaction.customId === 'open_onboarding_modal') {
        const modal = new ModalBuilder().setCustomId('onboarding_modal').setTitle('Setup');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('company_name').setLabel('Company').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }

      if (interaction.customId.startsWith("approve_")) {
        const userId = interaction.customId.split("_")[1];
        const onboard = onboardingData.get(userId);
        if (!onboard) return;
        await interaction.reply({ content: "⏳ Finalizing...", ephemeral: true });
        const member = await interaction.guild.members.fetch(userId);
        const name = formatWords(onboard.name);
        const company = formatWords(onboard.company);
        let role = interaction.guild.roles.cache.find(r => isSameCompany(r.name, company)) || await interaction.guild.roles.create({ name: company });
        await member.roles.add(role);
        await member.setNickname(`${name} | ${getAcronym(company)}`);
        let category = interaction.guild.channels.cache.find(c => c.name === company && c.type === ChannelType.GuildCategory);
        if (!category) {
          category = await interaction.guild.channels.create({ name: company, type: ChannelType.GuildCategory, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] }] });
          const basic = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.AddReactions, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak];
          await interaction.guild.channels.create({ name: 'general', type: ChannelType.GuildText, parent: category.id, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: role.id, allow: basic, deny: [PermissionsBitField.Flags.MentionEveryone, PermissionsBitField.Flags.ManageMessages] }] });
          await interaction.guild.channels.create({ name: 'Voice Call', type: ChannelType.GuildVoice, parent: category.id, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: role.id, allow: basic }] });
        }
        const welcomeChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase().includes("welcome"));
        if (welcomeChannel) {
          const newChannel = await welcomeChannel.clone();
          await welcomeChannel.delete().catch(() => {});
          await newChannel.setPosition(welcomeChannel.position);
          await newChannel.permissionOverwrites.create(role.id, { ViewChannel: false });
        }
        const rules = new EmbedBuilder().setTitle("📜 Inter Molds | Guidelines").setColor(0xF1C40F).setDescription("**1. Account Setup:** Use company email.\n**2. Privacy:** Category is private.\n**3. Production:** Use dedicated channels.\n**4. Growth:** Same Company Name to merge.\n**5. Help:** DM Admin.");
        await member.send({ embeds: [rules] }).catch(() => {});
        await interaction.channel.send({ content: `✅ Approved **${name}** from **${company}**` });
        onboardingData.delete(userId);
        await interaction.deleteReply().catch(() => {});
        await interaction.message.delete().catch(() => {});
      }
    }

    if (interaction.isStringSelectMenu()) {
      const data = session.get(interaction.user.id);
      if (!data) return;
      session.set(interaction.user.id, { ...data, targets: interaction.values });
      if (interaction.customId === "select_companies") {
        const modal = new ModalBuilder().setCustomId("broadcast_modal").setTitle("Message");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("message").setLabel("Message").setStyle(TextInputStyle.Paragraph).setRequired(true)));
        await interaction.showModal(modal);
      } else if (interaction.customId === "prod_select") {
        const modal = new ModalBuilder().setCustomId("production_modal").setTitle("Mold Details");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("mold_name").setLabel("Mold Name").setStyle(TextInputStyle.Short).setRequired(true)));
        await interaction.showModal(modal);
      }
    }
  } catch (err) { console.error("Error:", err); }
});

client.on(Events.MessageCreate, async msg => {
  if (msg.guild || msg.author.bot) return;
  if (repliedUsers.has(msg.author.id)) return;
  repliedUsers.add(msg.author.id);
  const dmEmbed = new EmbedBuilder().setColor(0x2F3136).setAuthor({ name: 'IMI | Inter Molds System', iconURL: client.user.displayAvatarURL() }).setTitle("✉️ Inter Molds System").setDescription("Notifications only.").setFooter({ text: "Official System" }).setTimestamp();
  await msg.reply({ embeds: [dmEmbed] });
});

client.login(process.env.TOKEN);
