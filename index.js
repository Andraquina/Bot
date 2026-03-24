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

const session = new Map();
const guildMemberCache = new Map();
const repliedUsers = new Set();
const onboardingData = new Map();

client.once(Events.ClientReady, async () => {
  console.log('🔥 BOT IS ONLINE');
  const commands = [
    new SlashCommandBuilder().setName('setup-broadcast').setDescription('Create broadcast panel')
  ].map(c => c.toJSON());
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log("✅ Commands registered");
  } catch (error) { console.error(error); }
});

function normalize(str) { return str.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function formatTitleCase(str) { return str.toLowerCase().split(/\s+/).filter(w => w.length > 0).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '); }
function getAcronym(company) { 
  const words = company.trim().split(/\s+/); 
  return words.length === 1 ? words[0].substring(0, 3).toUpperCase() : words.map(w => w[0].toUpperCase()).join(''); 
}
function isSameCompany(a, b) { return normalize(a).includes(normalize(b)) || normalize(b).includes(normalize(a)); }

client.on(Events.GuildMemberAdd, async member => {
  const channel = member.guild.channels.cache.find(c => c.name.toLowerCase().includes("welcome") && c.type === ChannelType.GuildText);
  if (!channel) return;
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_onboarding_modal').setLabel('Start Setup').setStyle(ButtonStyle.Primary));
  const welcomeMsg = await channel.send({ content: `Welcome <@${member.id}>! To access the server, please click the button below to register.`, components: [row] });
  onboardingData.set(member.id, { welcomeMsgId: welcomeMsg.id, welcomeChannelId: channel.id });
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused() || "";
      const roles = interaction.guild.roles.cache.filter(r => r.name !== "@everyone").map(r => r.name);
      const suggestions = roles.filter(r => r.toLowerCase().includes(focused.toLowerCase())).slice(0, 25);
      return await interaction.respond(suggestions.map(s => ({ name: s, value: s })));
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "setup-broadcast") {
      const button = new ButtonBuilder().setCustomId("start_broadcast").setLabel("📢 Start Broadcast").setStyle(ButtonStyle.Primary);
      await interaction.channel.send({ content: "📢 **Broadcast Panel**", components: [new ActionRowBuilder().addComponents(button)] });
      return interaction.reply({ content: "✅ Panel created.", flags: [4096] });
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'open_onboarding_modal') {
        const modal = new ModalBuilder().setCustomId('onboarding_modal').setTitle('Company Registration');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_name').setLabel('Your Full Name').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('company_name').setLabel('Your Company').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
      }

      if (interaction.customId.startsWith('approve_') || interaction.customId.startsWith('deny_')) {
        const [action, userId] = interaction.customId.split('_');
        const data = onboardingData.get(userId);
        if (!data) return interaction.reply({ content: "Session expired or already processed.", flags: [4096] });

        // IMPORTANT: Remove data immediately to prevent "ton of requests" loop
        onboardingData.delete(userId);

        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!member) return interaction.reply({ content: "User is no longer in the server.", flags: [4096] });

        if (action === 'approve') {
          const cleanName = formatTitleCase(data.name);
          const cleanCompany = formatTitleCase(data.company);
          const acronym = getAcronym(cleanCompany);

          // 1. Nickname
          await member.setNickname(`${cleanName} | ${acronym}`).catch(() => null);

          // 2. Role
          let role = interaction.guild.roles.cache.find(r => isSameCompany(r.name, cleanCompany));
          if (!role) role = await interaction.guild.roles.create({ name: cleanCompany, color: 0x3498db });
          await member.roles.add(role);

          // 3. Channels with SAFE permissions
          try {
            const category = await interaction.guild.channels.create({
              name: cleanCompany,
              type: ChannelType.GuildCategory,
              permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] }
              ]
            });

            await interaction.guild.channels.create({
              name: `general`,
              type: ChannelType.GuildText,
              parent: category.id,
              permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.EmbedLinks] }
              ]
            });

            await interaction.guild.channels.create({
              name: `Voice Call`,
              type: ChannelType.GuildVoice,
              parent: category.id,
              permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak, PermissionsBitField.Flags.Stream] }
              ]
            });
          } catch (chanErr) {
            console.error("Channel creation failed, but continuing approval:", chanErr);
          }

          // 4. DM Rules
          const rulesEmbed = new EmbedBuilder().setColor(0xF1C40F).setTitle('📜 Company Rules').setDescription('Welcome to **Inter Molds, Inc.**\nPlease follow the server guidelines and stay professional.');
          await member.send({ embeds: [rulesEmbed] }).catch(() => null);

          return interaction.update({ content: `✅ Approved ${cleanName} | ${cleanCompany}`, components: [] });
        } else {
          return interaction.update({ content: `❌ Denied registration for ${data.name}`, components: [] });
        }
      }

      // --- BROADCAST BUTTONS ---
      if (interaction.customId === "start_broadcast") {
        const dropdown = await buildDropdown(interaction.guild);
        const msg = await interaction.reply({ content: "🎯 Select companies:", components: [new ActionRowBuilder().addComponents(dropdown)], fetchReply: true });
        session.set(interaction.user.id, { message: msg });
        return;
      }
      
      const bData = session.get(interaction.user.id);
      if (!bData) return;
      if (interaction.customId === "confirm") {
        const { targetMembers, messageContent, message } = bData;
        await interaction.update({ content: `🚀 Sending...`, components: [] });
        let success = 0;
        for (const m of targetMembers.values()) {
          try { await m.send({ content: `📢 **Announcement:**\n${messageContent}` }); success++; } catch (e) {}
        }
        await message.edit({ content: `✅ Sent to ${success} users.` });
        session.delete(interaction.user.id);
      }
      if (interaction.customId === "cancel") { session.delete(interaction.user.id); return interaction.update({ content: "❌ Cancelled.", components: [] }); }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'onboarding_modal') {
        const name = interaction.fields.getTextInputValue('user_name');
        const company = interaction.fields.getTextInputValue('company_name');
        onboardingData.set(interaction.user.id, { name, company });

        const adminChan = interaction.guild.channels.cache.find(c => c.name.toLowerCase().includes("admin") && c.type === ChannelType.GuildText);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );
        await adminChan.send({ content: `🔔 **New Request**\n**User:** <@${interaction.user.id}>\n**Name:** ${name}\n**Company:** ${company}`, components: [row] });
        return interaction.reply({ content: "✅ Request sent to admins.", flags: [4096] });
      }

      if (interaction.customId === "broadcast_modal") {
        await interaction.deferUpdate();
        const data = session.get(interaction.user.id);
        const text = interaction.fields.getTextInputValue("message");
        const members = await interaction.guild.members.fetch();
        const targetMembers = members.filter(m => !m.user.bot && (data.targets.includes("all") || m.roles.cache.some(r => data.targets.some(t => isSameCompany(r.name, t)))));
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger));
        await data.message.edit({ content: `📢 **Preview** (Targeting ${targetMembers.size} users):\n\n${text}`, components: [row] });
        session.set(interaction.user.id, { ...data, messageContent: text, targetMembers });
      }
    }

    if (interaction.isStringSelectMenu()) {
      const data = session.get(interaction.user.id) || {};
      session.set(interaction.user.id, { ...data, targets: interaction.values });
      const modal = new ModalBuilder().setCustomId("broadcast_modal").setTitle("Message");
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("message").setLabel("Message").setStyle(TextInputStyle.Paragraph)));
      await interaction.showModal(modal);
    }

  } catch (err) { console.error("CRITICAL ERROR:", err); }
});

client.login(process.env.TOKEN);
