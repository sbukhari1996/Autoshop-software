import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';
import { optionalText, requiredText } from '../validation.js';


export function createCustomersRouter(prisma: PrismaClient) {
  const customersRouter = Router();

  customersRouter.get('/', asyncHandler(async (_req, res) => {
      const customers = await prisma.customer.findMany({
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        include: {
          vehicles: { select: { id: true, year: true, make: true, model: true } },
          _count: { select: { claims: true, jobs: true } },
        },
      });

      res.json(customers);
  }));

  customersRouter.post('/', asyncHandler(async (req, res) => {
    const firstName = requiredText(req.body.firstName, 'firstName');
    const lastName = requiredText(req.body.lastName, 'lastName');
    const customer = await prisma.customer.create({
      data: {
        firstName,
        lastName,
        phone: optionalText(req.body.phone, 'phone'),
        email: optionalText(req.body.email, 'email'),
        address: optionalText(req.body.address, 'address'),
      },
    });
    res.status(201).json(customer);
  }));

  customersRouter.get('/:id', asyncHandler(async (req, res) => {
    const customerId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        include: {
          vehicles: true,
          claims: { orderBy: { createdAt: 'desc' } },
          jobs: { orderBy: { createdAt: 'desc' }, select: { id: true, jobNumber: true, status: true } },
        },
      });

      if (!customer) {
        throw new ApiError(404, 'Customer not found');
      }

      res.json(customer);
  }));

  customersRouter.delete('/:id', asyncHandler(async (req, res) => {
    const customerId = requiredText(req.params.id, 'id');
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        _count: { select: { vehicles: true, claims: true, jobs: true, inspections: true, invoices: true } },
      },
    });
    if (!customer) throw new ApiError(404, 'Customer not found');

    const linked = Object.entries(customer._count).filter(([, count]) => count > 0);
    if (linked.length) {
      throw new ApiError(409, `Customer cannot be deleted while linked records exist: ${linked.map(([name, count]) => `${name} (${count})`).join(', ')}`);
    }

    await prisma.customer.delete({ where: { id: customerId } });
    res.status(204).send();
  }));

  return customersRouter;
}