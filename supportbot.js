/**
 * Based on the Ticket Bot Tutorial by Anson
 */

const discord = require('discord.js');
const client = new discord.Client();

const config = require('./config.json');
const prefix = config.prefix

var userTickets = new Map();

client.login(config.token);

client.on('ready', () => {
    console.log(client.user.username + " has logged in.");
    client.user.setStatus('available');
    client.user.setPresence({
        activity: {
            name: config.botStatus,
            type: 3,
        }
    });
});

client.on('message', message => {
    let messageArray = message.content.split(" ");
    let cmd = messageArray[0]
    let args = messageArray.slice(1);

    // Purge command to clear a certain amount of messages
    if(cmd === `${prefix}purge`){
        if(message.deletable) {
            message.delete();
        }

        if(!message.member.hasPermission("MANAGE_MESSAGES")){
            return message.reply("Missing Permissions!").then(m => m.delete(5000));
        }

        if(isNaN(args[0]) || parseInt(args[0]) <= 0){
            return message.reply("This is not a number.").then(m => m.delete(5000));
        }

        let deleteAmount;
        if(parseInt(args[0]) > 100) {
            deleteAmount = 100;
        } else {
            deleteAmount = parseInt(args[0]);
        }

        message.channel.bulkDelete(deleteAmount, true).catch(err => console.log(err));
    }

    if(message.author.bot) {
        var openTicketText = config.openTicketText;
        var firstWord = openTicketText.split(" ");

        if(message.embeds.length === 1 && message.embeds[0].description.startsWith(firstWord[0])) {
            message.react(config.openTicketEmote).then(msgReaction => console.log('Reacted')).catch(err => console.log(err));
        }
        if(message.embeds.length === 1 && message.embeds[0].title === 'Support Ticket') {
            message.react(config.closeTicketEmote).then(reaction => console.log("Reacted with " + reaction.emoji.name)).catch(err => console.log(err));
        }
    };

    if(message.content.toLowerCase() === `${prefix}supportsetup`) {
        const embed = new discord.RichEmbed();
        embed.setAuthor(client.user.username, client.user.displayAvatarURL);
        embed.setDescription(config.openTicketText);
        embed.setColor(config.supportEmbedColor);
        message.channel.send(embed);
    };
});

client.on('raw', payload => {
    if(payload.t === 'MESSAGE_REACTION_ADD') { // Check if the event name is MESSAGE_REACTION_ADD
        if(payload.d.emoji.name === config.openTicketEmote) // If the emoji is ticketreact
        {
            if(payload.d.message_id === config.supportMessage) { // Here we check if the id of the message is the ID of the embed that we had the bot send using the ?sendmsg command.
                let channel = client.channels.get(payload.d.channel_id) // Get the proper channel object.
                if(channel.messages.has(payload.d.message_id)) { // Check if the channel has the message in the cache.
                    return;
                }
                else { // Fetch the message and then get the reaction & user objects and emit the messageReactionAdd event manually.
                    channel.fetchMessage(payload.d.message_id)
                    .then(msg => {
                        let reaction = msg.reactions.get(config.openTicketEmote);
                        let user = client.users.get(payload.d.user_id);
                        client.emit('messageReactionAdd', reaction, user);
                    })
                    .catch(err => console.log(err));
                }
            }
        }
        // Check if the emoji is checkreact, meaning we're deleting the channel.
        // This will only be significant if our bot crashes/restarts and there are additional ticket channels that have not been closed.
        else if(payload.d.emoji.name === config.closeTicketEmote) {
            let channel = client.channels.get(payload.d.channel_id);
            if(channel.messages.has(payload.d.message_id)) {
                return;
            }
            else {
                channel.fetchMessage(payload.d.message_id)
                .then(msg => {
                    let reaction = msg.reactions.get(config.closeTicketEmote);
                    let user = client.users.get(payload.d.user_id);
                    client.emit('messageReactionAdd', reaction, user);
                })
            }
        }
    }
});

client.on('messageReactionAdd', (reaction, user) => {
    if(reaction.emoji.name === config.openTicketEmote) { // If the emoji name is ticketreact, we will create the ticket channel.
        if(userTickets.has(user.id) || reaction.message.guild.channels.some(channel => channel.name.toLowerCase() === user.username + config.newTicketSuffix)) {
            user.send(config.openTicket); // Send user msg indicating they have a ticket.
        }
        else {
            let guild = reaction.message.guild;
            // Create channel based on permissions. Note, you need to modify the permissionsOverwrites array to fit your needs for permissions.
            guild.createChannel(user.username + config.newTicketSuffix, {
                type: 'text',
                permissionOverwrites: [
                    {
                        allow: 'VIEW_CHANNEL',
                        id: user.id
                    },
                    {
                        deny: 'VIEW_CHANNEL',
                        id: config.supportRole
                    },
                    {
                        allow: 'VIEW_CHANNEL',
                        id: guild.id
                    }
                ]
            }).then(ch => {
                // Sets the parent of the newly created channel to the support category.
                ch.setParent(config.supportCat);

                userTickets.set(user.id, ch.id); // Once ticket is created, set the user's id as a key mapping to the channel id.
                let embed = new discord.RichEmbed();
                embed.setTitle(config.newTicketTitle);
                embed.setDescription(config.newTicketDesc);
                embed.setColor(config.newTicketColor);
                ch.send(embed) // Send a message to user.
            }).catch(err => console.log(err));
        }
    }
    else if(reaction.emoji.name === config.closeTicketEmote) {
        // If emoji is checkreact, they are trying to close the ticket.
        if(userTickets.has(user.id)) {
            if(reaction.message.channel.id === userTickets.get(user.id)) {
                let embed = new discord.RichEmbed();
                embed.setDescription(config.closingTicket)
                reaction.message.channel.send(embed);
                setTimeout(() => {
                    reaction.message.channel.delete('Closing Ticket')
                    .then(channel => {
                        console.log(channel.name + ' deleted');
                    })
                    .catch(err => console.log(err));
                }, 5000);
            }
        }
        // This case is really for handling tickets that were not closed by the bot due to the bot possibly crashing.
        // In order for this to actually work, the user needs to have a ticket opened already.
        else if(reaction.message.guild.channels.some(channel => channel.name.toLowerCase() === user.username + config.newTicketSuffix)) {
            let embed = new discord.RichEmbed();
            embed.setDescription(config.closingTicket);
            reaction.message.channel.send(embed);
            setTimeout(() => {
                reaction.message.guild.channels.forEach(channel => {
                    if(channel.name.toLowerCase() === user.username + config.newTicketSuffix) {
                        channel.delete().then(ch => console.log('Deleting ' + ch.id))
                    }
                });
            }, 5000);
        }
    }
});