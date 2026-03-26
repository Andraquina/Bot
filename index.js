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
// READY & COMMANDS
// =========================
client.once(Events.ClientReady, async () => {
  console.log('🔥 IMI SYSTEM ONLINE');

  const commands = [
    new SlashCommandBuilder()
      .setName('setup-broadcast')
      .setDescription('Create broadcast panel'),
    new SlashCommandBuilder()
      .setName('create-production')
      .setDescription('Create the permanent Production Channel button')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("✅ Commands Registered");
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

async function buildRoleDropdown(guild, customId) {
  await guild.roles.fetch();
  const roles = guild.roles.cache.filter(r => r.name !== "@everyone" && !r.managed).map(r => r.name).slice(0, 25);
  return new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder("Select Company Role").setMinValues(1).setMaxValues(1)
    .addOptions(roles.map(r => ({ label: r, value: r })));
}

// =========================
// 👋 JOIN SYSTEM & 5-MIN KICK
// =========================
client.on(Events.GuildMemberAdd, async member => {
  const channel = member.guild.channels.cache.find(c => c.name.toLowerCase().includes("welcome"));
  if (!channel) return;

  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_onboarding_modal').setLabel('Start Setup').setStyle(ButtonStyle.Primary));
  const msg = await channel.send({ content: `<@${member.id}> Welcome! Click below to start. You have **5 minutes** to submit your info.`, components: [row] });

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
    // 1. SLASH COMMANDS
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "setup-broadcast") {
        const btn = new ButtonBuilder().setCustomId("start_broadcast").setLabel("📢 Start Broadcast").setStyle(ButtonStyle.Primary);
        await interaction.channel.send({ content: "📢 **Broadcast Panel**\nClick below to start a message broadcast:", components: [new ActionRowBuilder().addComponents(btn)] });
        return interaction.reply({ content: "✅ Broadcast Panel created.", ephemeral: true });
      }

      if (interaction.commandName === "create-production") {
        const btn = new ButtonBuilder().setCustomId("start_production_flow").setLabel("🏗️ Create Production").setStyle(ButtonStyle.Success);
        await interaction.channel.send({ content: "🏗️ **Production Panel**\nClick below to create a new private Mold channel:", components: [new ActionRowBuilder().addComponents(btn)] });
        return interaction.reply({ content: "✅ Production Panel created.", ephemeral: true });
      }
    }

    // 2. MODAL SUBMISSIONS
    if (interaction.isModalSubmit()) {
      const data = session.get(interaction.user.id);
      
      if (interaction.customId === "broadcast_modal") {
        await interaction.deferUpdate();
        if (!data) return;
        const text = interaction.fields.getTextInputValue("message");
        const members = await interaction.guild.members.fetch();
        const targetMembers = members.filter(m => !m.user.bot && (data.targets.includes("all") || m.roles.cache.some(r => data.targets.some(t => isSameCompany(r.name, t)))));
        const btns = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("confirm_bc").setLabel("Confirm").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("cancel_flow").setLabel("Cancel").setStyle(ButtonStyle.Danger)
        );
        
        // Broadcast Preview - SPACIOUS with separate lines/icons
        const previewContent = 
          `📢 **Broadcast Preview**\n\n` +
          `🎯 Targets: all\n` +
          `💬 Message: ${text}`;
          
        await data.message.edit({ content: previewContent, components: [btns] });
        session.set(interaction.user.id, { ...data, messageContent: text, targetMembers });
        return;
      }

      if (interaction.customId === "production_modal") {
        await interaction.deferUpdate();
        if (!data) return;
        const moldName = interaction.fields.getTextInputValue("mold_name");
        const roleName = data.targets[0];
        const moldAcronym = interaction.fields.getTextInputValue("mold_acronym").toUpperCase();

        const btns = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("confirm_prod").setLabel("Confirm Creation").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("cancel_flow").setLabel("Cancel").setStyle(ButtonStyle.Danger)
        );
        
        // Production Preview - SPACIOUS with separate lines/icons (Matching your photo)
        const previewContent = 
          `🏗️ **Production Preview**\n\n` +
          `**Company:** ${roleName}\n` +
          `**Mold ID:** ${moldName}\n` +
          `**Acronym:** ${moldAcronym}`;
          
        await data.message.edit({ content: previewContent, components: [btns] });
        session.set(interaction.user.id, { ...data, moldName, moldAcronym });
        return;
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

    // 3. SELECT MENUS
    if (interaction.isStringSelectMenu()) {
      const data = session.get(interaction.user.id) || {};
      session.set(interaction.user.id, { ...data, targets: interaction.values });

      if (interaction.customId === "bc_select") {
        const modal = new ModalBuilder().setCustomId("broadcast_modal").setTitle("Broadcast Message");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("message").setLabel("Message").setStyle(TextInputStyle.Paragraph).setRequired(true)));
        return interaction.showModal(modal);
      }

      if (interaction.customId === "prod_select") {
        // PRODUCTION Modal (Adding spaciousness and the separate acronym input from the image structure)
        const modal = new ModalBuilder().setCustomId("production_modal").setTitle("Production Details");
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("mold_name").setLabel("Mold Name / ID (e.g., M-A102)").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("mold_acronym").setLabel("Acronym (e.g., MA102)").setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
      }
    }

    // 4. BUTTONS
    if (interaction.isButton()) {
      const data = session.get(interaction.user.id);

      // PANELS
      if (interaction.customId === "start_broadcast") {
        const roles = interaction.guild.roles.cache.filter(r => r.name !== "@everyone" && !r.managed).map(r => r.name).slice(0, 24);
        const dropdown = new StringSelectMenuBuilder().setCustomId("bc_select").setPlaceholder("Select targets").setMinValues(1).setMaxValues(Math.min(roles.length + 1, 25))
          .addOptions([{ label: "ALL", value: "all" }, ...roles.map(r => ({ label: r, value: r }))]);
        const msg = await interaction.channel.send({ content: "🎯 **Broadcast Setup**\nSelect target companies:", components: [new ActionRowBuilder().addComponents(dropdown)] });
        session.set(interaction.user.id, { message: msg });
        return interaction.reply({ content: "Broadcast Setup started below.", ephemeral: true });
      }

      if (interaction.customId === "start_production_flow") {
        const dropdown = await buildRoleDropdown(interaction.guild, "prod_select");
        const msg = await interaction.channel.send({ content: "🏗️ **Production Setup**\nSelect company role:", components: [new ActionRowBuilder().addComponents(dropdown)] });
        session.set(interaction.user.id, { message: msg });
        return interaction.reply({ content: "Production Setup started below.", ephemeral: true });
      }

      if (interaction.customId === 'open_onboarding_modal') {
        const modal = new ModalBuilder().setCustomId('onboarding_modal').setTitle('Setup');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('company_name').setLabel('Company').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }

      // SESSION LOGIC
      if (data) {
        if (interaction.customId === "confirm_bc") {
          const { targetMembers, messageContent, message } = data;
          await interaction.update({ content: `🚀 Sending broadcast...`, components: [] });
          let success = 0;
          for (const m of targetMembers.values()) {
            try { await m.send({ embeds: [new EmbedBuilder().setColor(0x3498db).setTitle("📢 Announcement").setDescription(messageContent).setFooter({ text: "Inter Molds, Inc." }).setTimestamp()] }); success++; } catch {}
          }
          
          // Spacious Broadcast Completed layout with icons
          const successContent = 
            `✅ **Broadcast Completed**\n\n` +
            `🎯 Targets: all\n` +
            `👤 Sent: ${success}\n` +
            `💬 ${messageContent}`;
            
          await interaction.channel.send({ content: successContent });
          await message.delete().catch(() => {});
          session.delete(interaction.user.id);
          return;
        }

        if (interaction.customId === "confirm_prod") {
          await interaction.update({ content: `🏗️ Creating channel...`, components: [] });
          const role = interaction.guild.roles.cache.find(r => r.name === data.targets[0]);
          const category = interaction.guild.channels.cache.find(c => c.name === role.name && c.type === ChannelType.GuildCategory);
          const basicPerms = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.AddReactions, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak];
          
          const newChan = await interaction.guild.channels.create({
            name: `${data.moldAcronym.toLowerCase()}-tracking`, // Using theronym in the channel name
            type: ChannelType.GuildText, parent: category.id,
            permissionOverwrites: [
              { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
              { id: role.id, allow: basicPerms, deny: [PermissionsBitField.Flags.MentionEveryone, PermissionsBitField.Flags.ManageMessages] }
            ]
          });
          
          // Spacious Production Completed layout with icons (MATCHING IMAGE)
          const finalProdSuccess = 
            `✅ **Production Tracking Created**\n\n` +
            `**Company:** ${role.name}\n` +
            `**Mold ID:** ${data.moldName}\n` +
            `**Channel:** <#${newChan.id}>`;
            
          await interaction.channel.send({ content: finalProdSuccess });
          await data.message.delete().catch(() => {});
          session.delete(interaction.user.id);
          return;
        }

        if (interaction.customId === "cancel_flow") { 
          await data.message.delete().catch(() => {});
          session.delete(interaction.user.id); 
          return interaction.reply({ content: "❌ Session Cancelled.", ephemeral: true }); 
        }
      }

      // APPROVALS
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
        const rules = new EmbedBuilder().setTitle("📜 Inter Molds | Guidelines").setColor(0xF1C40F).setDescription("**1. Account Setup:** Use company email.\n**2. Privacy:** Your category is private.\n**3. Production:** Use dedicated mold channels.\n**4. Growth:** Same Company Name to merge.\n**5. Help:** DM an Admin directly.");
        await member.send({ embeds: [rules] }).catch(() => {});
        await interaction.channel.send({ content: `✅ Approved **${name}** from **${company}**` });
        onboardingData.delete(userId);
        await interaction.deleteReply().catch(() => {});
        await interaction.message.delete().catch(() => {});
      }
    }
  } catch (err) { console.error("Error:", err); }
});

// DM Embed
client.on(Events.MessageCreate, async msg => {
  if (msg.guild || msg.author.bot) return;
  if (repliedUsers.has(msg.author.id)) return;
  repliedUsers.add(msg.author.id);
  const dmEmbed = new EmbedBuilder().setColor(0x2F3136).setAuthor({ name: 'IMI | Inter Molds System', iconURL: client.user.displayAvatarURL() }).setTitle("✉️ Inter Molds System").setDescription("This bot is for notifications only. Contact an admin directly.").setFooter({ text: "Official System Notification" }).setTimestamp();
  await msg.reply({ embeds: [dmEmbed] });
});

client.login(process.env.TOKEN);
