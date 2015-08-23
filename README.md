#Evergram Print Consumer

[![Shippable](https://img.shields.io/shippable/55c55c0239bd620c007ce87f.svg)](https://app.shippable.com/projects/55c55c0239bd620c007ce87f)

A service that communicates with a print SQS, retrieves the ready for print image sets, downloads the images, zips them up, uploads it to S3 and then emails an admin to handle the fulfillment.

###Install Node.JS

In the terminal:

```
wget -qO- https://raw.githubusercontent.com/creationix/nvm/v0.24.0/install.sh | bash

nvm install stable
```

###Clone

```
git clone git@github.com:evergram/evergram-api.git
```

###Init

```
cd evergram-api
npm install
```

###Run

```
npm start
```

###Examples

#### Auth a user

```
http://localhost:8080/user/auth/instagram
```