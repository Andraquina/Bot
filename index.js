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



    if (interaction.isButton()) {



      if (interaction.customId === 'open_onboarding_modal') {

        const modal = new ModalBuilder()

          .setCustomId('onboarding_modal')

          .setTitle('Company Registration');



        modal.addComponents(

          new ActionRowBuilder().addComponents(

            new TextInputBuilder().setCustomId('user_name').setLabel('Your Name').setStyle(TextInputStyle.Short).setRequired(true)

          ),

          new ActionRowBuilder().addComponents(

            new TextInputBuilder().setCustomId('company_name').setLabel('Company').setStyle(TextInputStyle.Short).setRequired(true)

          )

        );



        return interaction.showModal(modal);

      }



      if (interaction.customId.startsWith('approve_') || interaction.customId.startsWith('deny_')) {



        const [action, userId] = interaction.customId.split('_');

        const data = onboardingData.get(userId);

        if (!data) return;



        if (action === 'approve') {



          await interaction.deferUpdate();



          const member = await interaction.guild.members.fetch(userId);

          const cleanName = formatTitleCase(data.name);

          const cleanCompany = formatTitleCase(data.company);

          const acronym = getAcronym(cleanCompany);



          const welcomeChan = interaction.guild.channels.cache.get(data.welcomeChannelId);



          let role = interaction.guild.roles.cache.find(r => isSameCompany(r.name, cleanCompany));

          if (!role) role = await interaction.guild.roles.create({ name: cleanCompany });



          await member.roles.add(role);

          await member.setNickname(`${cleanName} | ${acronym}`);



          // Create category + channels with proper permissions

          const category = await interaction.guild.channels.create({

            name: cleanCompany,

            type: ChannelType.GuildCategory,

            permissionOverwrites: [

              { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },

              { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] }

            ]

          });



          const perms = [

            PermissionsBitField.Flags.ViewChannel,

            PermissionsBitField.Flags.SendMessages,

            PermissionsBitField.Flags.ReadMessageHistory,

            PermissionsBitField.Flags.AttachFiles,

            PermissionsBitField.Flags.EmbedLinks,

            PermissionsBitField.Flags.AddReactions

          ];



          await interaction.guild.channels.create({

            name: 'general',

            type: ChannelType.GuildText,

            parent: category.id,

            permissionOverwrites: [

              { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },

              { id: role.id, allow: perms }

            ]

          });



          await interaction.guild.channels.create({

            name: 'Voice Call',

            type: ChannelType.GuildVoice,

            parent: category.id,

            permissionOverwrites: [

              { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },

              { id: role.id, allow: [

                PermissionsBitField.Flags.ViewChannel,

                PermissionsBitField.Flags.Connect,

                PermissionsBitField.Flags.Speak

              ]}

            ]

          });



          // Wipe welcome channel

          if (welcomeChan) {

            const newChannel = await welcomeChan.clone();

            await welcomeChan.delete();

            await newChannel.setPosition(welcomeChan.position);

          }



          // DM

          await member.send(`✅ You've been approved! Welcome to **Inter Molds, Inc.** 🎉`);

          await member.send({

            embeds: [

              new EmbedBuilder()

                .setTitle("📜 Rules")

                .setDescription("• Be respectful\n• No spam\n• Follow rules")

            ]

          });



          await interaction.editReply({

            content: `✅ Approved ${cleanName} (${cleanCompany})`,

            components: []

          });

        }



        if (action === 'deny') {

          return interaction.update({ content: `❌ Denied ${data.name}`, components: [] });

        }

      }



     // =========================

// 📢 BROADCAST HELPERS

// =========================

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

// 📢 BROADCAST INTERACTIONS

// =========================



// START BROADCAST

if (interaction.isButton() && interaction.customId === "start_broadcast") {



  await interaction.deferReply();



  const dropdown = await buildDropdown(interaction.guild);



  const reply = await interaction.editReply({

    content: "🎯 Select companies:",

    components: [new ActionRowBuilder().addComponents(dropdown)]

  });



  session.set(interaction.user.id, {

    message: reply

  });



  return;

}





// SELECT COMPANIES

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





// MODAL → PREVIEW

if (interaction.isModalSubmit() && interaction.customId === "broadcast_modal") {



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

    new ButtonBuilder()

      .setCustomId("confirm")

      .setLabel("Confirm")

      .setStyle(ButtonStyle.Success),



    new ButtonBuilder()

      .setCustomId("back")

      .setLabel("✏️ Edit")

      .setStyle(ButtonStyle.Secondary),



    new ButtonBuilder()

      .setCustomId("cancel")

      .setLabel("Cancel")

      .setStyle(ButtonStyle.Danger)

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





// BACK → EDIT TARGETS

if (interaction.isButton() && interaction.customId === "back") {



  const data = session.get(interaction.user.id);

  if (!data) return;



  const dropdown = await buildDropdown(interaction.guild, data.targets);



  return interaction.update({

    content: "🎯 Select companies:",

    components: [new ActionRowBuilder().addComponents(dropdown)]

  });

}





// CANCEL

if (interaction.isButton() && interaction.customId === "cancel") {

  session.delete(interaction.user.id);



  return interaction.update({

    content: "❌ Broadcast cancelled.",

    components: []

  });

}





// CONFIRM SEND

if (interaction.isButton() && interaction.customId === "confirm") {



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



    // progress update

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



// =========================

// DM SYSTEM (UNCHANGED)

// =========================

client.on(Events.MessageCreate, async (message) => {

  if (message.author.bot || message.guild) return;

  if (repliedUsers.has(message.author.id)) return;



  await message.reply("📩 **Inter Molds System**\nThis bot is for notifications only.");



  repliedUsers.add(message.author.id);

});
