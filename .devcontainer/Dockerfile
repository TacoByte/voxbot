FROM node:25-bookworm

# Install Postgres
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
&& apt-get -y install --no-install-recommends git ca-certificates postgresql postgresql-contrib \
&& apt-get clean -y && rm -rf /var/lib/apt/lists/*

# Grant the user (usually 'node' or 'vscode') permissions to run postgres
# Codespaces usually uses 'vscode' as the default user
RUN sed -i 's/peer/trust/' /etc/postgresql/*/main/pg_hba.conf \
&& sed -i 's/md5/trust/' /etc/postgresql/*/main/pg_hba.conf

RUN corepack enable && corepack prepare pnpm@9 --activate

USER node
