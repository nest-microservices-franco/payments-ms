import { Inject, Injectable } from '@nestjs/common';
import { NATS_CLIENT, envs } from 'src/config';
import Stripe from 'stripe';
import { PaymentSessionDto } from './dto/payment-session.dto';
import { Request, Response } from 'express';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class PaymentsService {
  private readonly stripe = new Stripe(envs.stripeSecret);
  constructor(@Inject(NATS_CLIENT) private readonly client: ClientProxy) {}

  async createPaymentSession(paymentSessionDto: PaymentSessionDto) {
    const { currency, items, orderId } = paymentSessionDto;

    const line_items = items.map((item) => ({
      price_data: {
        currency: currency,
        product_data: {
          name: item.name,
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.quantity,
    }));

    const session = await this.stripe.checkout.sessions.create({
      // Colocar id de la orden♦
      payment_intent_data: {
        metadata: {
          orderId,
        },
      },
      line_items,
      mode: 'payment',
      success_url: envs.successUrl,
      cancel_url: envs.cancelUrl,
    });

    return {
      cancelUrl: session.cancel_url,
      successUrl: session.success_url,
      url: session.url,
    };
  }

  async stripeWebhook(req: Request, res: Response) {
    const sig = req.headers['stripe-signature'];

    // Production
    const endpointSecret = envs.stripeEndpointSecret;
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        req['rawBody'],
        sig,
        endpointSecret,
      );
    } catch (err) {
      console.log(err);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    switch (event.type) {
      case 'charge.succeeded': {
        const chargeSucceeded = event.data.object;
        const payload = {
          stripePaymentId: chargeSucceeded.id,
          orderId: chargeSucceeded.metadata.orderId,
          receiptUrl: chargeSucceeded.receipt_url,
        };

        this.client.emit('payment.succeeded', payload);
        break;
      }
      default: {
        console.log(`Unhandled event type: ${event.type}`);
      }
    }

    return res.status(200).json({ sig });
  }
}
