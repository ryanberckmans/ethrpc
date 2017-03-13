FROM node:6.9

COPY package.json /ethrpc/package.json
WORKDIR /ethrpc
RUN npm install

COPY . /ethrpc

ENTRYPOINT [ "/ethrpc/node_modules/.bin/mocha" ]