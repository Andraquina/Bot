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
const onboardingData = new Map();

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

// Fixes: "anDRÉ mENdes" -> "André Mendes"
function formatTitleCase(str) {
  return str.toLowerCase().split(/\s+/).filter(w => w.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

// Fixes: "Inter Molds Inc" -> "IMI"
function getAcronym(company) {
  const words = company.trim().split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 3).toUpperCase();
  return words.map(w => w[0].toUpperCase()).join('');
}

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

  const welcomeMsg = await channel.send({
    content: `Welcome <@${member.id}>! To access the server, please click the button below to register.`,
    components: [row]
  });

  onboardingData.set(member.id, { 
    welcomeMsgId: welcomeMsg.id, 
    welcomeChannelId: channel.id 
  });
});

// =========================
// 📋 INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused() || "";
      const roles = interaction.guild.roles.cache.filter(r => r.name !== "@everyone").map(r => r.name);
      const results = roles.filter(r => r.toLowerCase().includes(focused.toLowerCase())).slice(0, 25);
      return await interaction.respond(results.map(r => ({ name: r, value: r })));
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
        if (!data) return interaction.reply({ content: "Session expired.", ephemeral: true });

        const member = await interaction.guild.members.fetch(userId).catch(() => null);

        if (action === 'approve') {
          if (!member) return interaction.reply({ content: "User left server.", ephemeral: true });

          // 🔥 APPLY CAPITALIZATION & ACRONYM LOGIC
          const cleanName = formatTitleCase(data.name);
          const cleanCompany = formatTitleCase(data.company);
          const acronym = getAcronym(cleanCompany);

          // 1. Set Nickname: André Mendes | IMI
          try {
            await member.setNickname(`${cleanName} | ${acronym}`);
          } catch (e) { console.error("Could not set nickname (Missing Permissions or Higher Role)"); }

          // 2. Assign Role (Full Formatted Name)
          let role = interaction.guild.roles.cache.find(r => isSameCompany(r.name, cleanCompany));
          if (!role) {
            role = await interaction.guild.roles.create({ name: cleanCompany, color: 'Blue', reason: 'Onboarding' });
          }
          await member.roles.add(role);

          // 3. Create Category (Full Name) & Channels
          const category = await interaction.guild.channels.create({
            name: cleanCompany.toUpperCase(),
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
              { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
              { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] }
            ]
          });
          await interaction.guild.channels.create({ name: `text-chat`, type: ChannelType.GuildText, parent: category.id });
          await interaction.guild.channels.create({ name: `voice-chat`, type: ChannelType.GuildVoice, parent: category.id });

          // 4. Cleanup Welcome Message & Hide Channel
          if (data.welcomeMsgId && data.welcomeChannelId) {
            const welcomeChan = interaction.guild.channels.cache.get(data.welcomeChannelId);
            if (welcomeChan) {
              const msg = await welcomeChan.messages.fetch(data.welcomeMsgId).catch(() => null);
              if (msg) await msg.delete().catch(() => null);
              await welcomeChan.permissionOverwrites.create(member.id, { ViewChannel: false });
            }
          }

          // 5. Send Professional Rules DM (Yellow Embed)
          try {
            await member.send(`✅ You've been approved! Welcome to **Inter Molds, Inc.** 🎉`);
            const rulesEmbed = new EmbedBuilder()
              .setColor(0xF1C40F)
              .setTitle('📜 Company Rules')
              .setDescription('──────────────\n\n**1. Be respectful**\n**2. No spam**\n**3. Follow all guidelines**\n**4. Keep discussions professional**\n**5. Respect privacy**\n\n──────────────')
              .setFooter({ 
                text: `Inter Molds, Inc. • ${new Date().toLocaleDateString('pt-PT')} ${new Date().toLocaleTimeString('pt-PT', {hour: '2-digit', minute:'2-digit'})}`, 
                iconURL: interaction.guild.iconURL() 
              });
            await member.send({ embeds: [rulesEmbed] });
          } catch (e) { console.log("DM failed."); }

          await interaction.update({ content: `✅ Approved ${cleanName} (${cleanCompany})`, components: [] });
        } else {
          await interaction.update({ content: `❌ Denied ${data.name}`, components: [] });
        }
        onboardingData.delete(userId);
        return;
      }

      // BROADCAST START
      if (interaction.customId === "start_broadcast") {
        const dropdown = await buildDropdown(interaction.guild);
        const msg = await interaction.reply({ content: "🎯 Select targets:", components: [new ActionRowBuilder().addComponents(dropdown)], fetchReply: true });
        session.set(interaction.user.id, { message: msg });
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'onboarding_modal') {
        const name = interaction.fields.getTextInputValue('user_name');
        const company = interaction.fields.getTextInputValue('company_name');
        
        // Store name/company before approval
        const current = onboardingData.get(interaction.user.id) || {};
        onboardingData.set(interaction.user.id, { ...current, name, company });

        // SAFETY: Only target TEXT channels
        const adminChan = interaction.guild.channels.cache.find(c => 
          c.name.toLowerCase().includes("admin") && c.type === ChannelType.GuildText
        );

        if (!adminChan) return interaction.reply({ content: "Error: Admin text channel not found.", ephemeral: true });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );

        await adminChan.send({ 
          content: `🔔 **New Request**\n**User:** <@${interaction.user.id}>\n**Name:** ${name}\n**Company:** ${company}`, 
          components: [row] 
        });
        
        return interaction.reply({ content: "✅ Info submitted. Please wait for admin approval.", ephemeral: true });
      }
      
      // BROADCAST MODAL
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

    if (interaction.isStringSelectMenu() && interaction.customId === "select_companies") {
      session.set(interaction.user.id, { ...session.get(interaction.user.id), targets: interaction.values });
      const modal = new ModalBuilder().setCustomId("broadcast_modal").setTitle("Message");
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("message").setLabel("Text").setStyle(TextInputStyle.Paragraph)));
      await interaction.showModal(modal);
    }

  } catch (err) { console.error("Interaction Error:", err); }
});

client.login(process.env.TOKEN);
